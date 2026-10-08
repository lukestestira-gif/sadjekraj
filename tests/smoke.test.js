const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const crypto=require('node:crypto');

async function freePort(){
  return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
}
function tomorrowWorkingDay(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const f=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const day=new Date(`${f.year}-${f.month}-${f.day}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate()+1);
  while(day.getUTCDay()===0)day.setUTCDate(day.getUTCDate()+1);
  return day.toISOString().slice(0,10);
}
test('customer booking without public cancellation, admin control + blackout',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'barber-atelier-qa-'));
  fs.mkdirSync(path.join(temp,'data'));
  fs.copyFileSync(path.join(__dirname,'..','server.js'),path.join(temp,'server.js'));
  // Isolated test fixtures; no access to actual salon reservations.
  fs.writeFileSync(path.join(temp,'data','db.json'),JSON.stringify({
    settings:{salonName:'Test Salon'},gallery:[{id:'legacy',image:'/uploads/legacy.jpg'},{id:'hidden',image:'/uploads/hidden.jpg',active:false}],bookings:[],blackouts:[],
    services:[{id:'hair',name:'Cut',duration:30,price:1200,cost:0,active:true}],
    barbers:[{id:'alex',name:'Alex',workStart:'09:00',workEnd:'19:00',workDays:[1,2,3,4,5,6],active:true}]
  }));
  const port=await freePort(),server=spawn(process.execPath,['server.js'],{
    cwd:temp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ADMIN_USER:'qaadmin',ADMIN_PASS:'not-a-real-password-test-only'},stdio:'ignore'
  });
  const base=`http://127.0.0.1:${port}`;
  const req=async(endpoint,method='GET',body,cookie)=>{
    const response=await fetch(base+endpoint,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
  try{
    let ready=false;
    for(let i=0;i<50;i++){
      try{const r=await req('/api/public');if(r.status===200){ready=true;break;}}catch{}
      await new Promise(done=>setTimeout(done,100));
    }
    assert.ok(ready,'server starts');
    const publicSite = await req('/api/public');
    assert.deepEqual(publicSite.data.gallery.map(x => x.id), ['legacy'], 'legacy photos visible; explicitly hidden photos stay hidden');
    const day=tomorrowWorkingDay();
    const avail=await req(`/api/availability?serviceId=hair&barberId=alex&date=${day}`);
    assert.equal(avail.status,200);
    assert.ok(avail.data.slots.length);
    const time=avail.data.slots[0].time;
    const details={date:day,time,serviceId:'hair',barberId:'alex',name:'Test Guest',phone:'+381 61 999 8877'};
    const created=await req('/api/bookings','POST',details);
    assert.equal(created.status,201);
    assert.match(created.data.booking.code,/^[A-F0-9]{14}$/);
    assert.equal((await req('/api/bookings','POST',details)).status,409,'duplicate blocked');
    const auth={code:created.data.booking.code,phone:details.phone};
    assert.equal((await req('/api/bookings/lookup','POST',auth)).status,404,'customer lookup and editing are disabled');
    assert.equal((await req('/api/bookings/cancel','POST',auth)).status,404,'public cancellation is disabled');
    assert.equal((await req('/api/bookings','POST',details)).status,409,'existing appointment still blocks duplicate');
    const createdAgainCode = created.data.booking.code;

    const login=await req('/api/admin/login','POST',{username:'qaadmin',password:'not-a-real-password-test-only'});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const dashboard=await req('/api/admin/dashboard','GET',undefined,cookie);
    assert.equal(dashboard.status,200);
    const appointment=dashboard.data.bookings.find(b=>b.code===createdAgainCode);
    assert.ok(appointment,'appointment saved in admin view');
    const cancelled=await req(`/api/admin/bookings/${appointment.id}`,'PUT',{status:'cancelled'},cookie);
    assert.equal(cancelled.status,200,'staff can cancel appointment');
    assert.equal(cancelled.data.booking.status,'cancelled');
    assert.ok((await req(`/api/availability?serviceId=hair&barberId=alex&date=${day}`)).data.slots.some(s=>s.time===time),'admin cancellation releases slot');
    const closed=await req('/api/admin/blackouts','POST',{dateFrom:day,dateTo:day,barberId:'alex',reason:'Vacation'},cookie);
    assert.equal(closed.status,201);
    assert.equal((await req(`/api/availability?serviceId=hair&barberId=alex&date=${day}`)).data.slots.length,0);
    assert.equal((await req('/api/bookings','POST',details)).status,409);
    assert.equal((await req('/api/admin/blackouts/'+closed.data.blackout.id,'DELETE',undefined,cookie)).status,200);
    assert.ok((await req('/api/next-available?serviceId=hair&barberId=alex')).data.slots.length);
  }finally{server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
});


test('reset-admin recovers from prior stored hash without changing salon data',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'barber-atelier-reset-'));
  fs.mkdirSync(path.join(temp,'data'));
  fs.mkdirSync(path.join(temp,'scripts'));
  fs.copyFileSync(path.join(__dirname,'..','server.js'),path.join(temp,'server.js'));
  fs.copyFileSync(path.join(__dirname,'..','scripts','reset-admin.js'),path.join(temp,'scripts','reset-admin.js'));
  const db={settings:{salonName:'Existing Customer Salon'},bookings:[{id:'old-booking',name:'Customer'}],services:[],barbers:[]};
  fs.writeFileSync(path.join(temp,'data','db.json'),JSON.stringify(db));
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync('old-unknown-password',salt,64).toString('hex');
  fs.writeFileSync(path.join(temp,'data','admin-auth.json'),JSON.stringify({salt,hash}));
  const environment={...process.env};delete environment.ADMIN_PASS;
  const before=fs.readFileSync(path.join(temp,'data','db.json'),'utf8');
  const reset=spawnSync(process.execPath,['scripts/reset-admin.js'],{cwd:temp,env:environment,encoding:'utf8'});
  assert.equal(reset.status,0,reset.stderr);
  assert.equal(fs.existsSync(path.join(temp,'data','admin-auth.json')),false);
  assert.equal(fs.readdirSync(path.join(temp,'data')).filter(x=>x.startsWith('admin-auth.json.backup-')).length,1);
  assert.equal(fs.readFileSync(path.join(temp,'data','db.json'),'utf8'),before);
  const port=await freePort();
  const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...environment,PORT:String(port),HOST:'127.0.0.1',ADMIN_USER:'admin'},stdio:'ignore'});
  const req=async(endpoint,method='GET',body,cookie)=>{
    const r=await fetch(`http://127.0.0.1:${port}${endpoint}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json(),headers:r.headers};
  };
  try{
    let up=false;
    for(let i=0;i<60;i++){
      try {if((await req('/api/admin/session')).status===200){up=true;break;}}catch{}
      await new Promise(done=>setTimeout(done,100));
    }
    assert.ok(up,'server started');
    assert.equal((await req('/api/admin/login','POST',{username:'admin',password:'incorrect'})).status,401);
    const login=await req('/api/admin/login','POST',{username:'admin',password:'Barber123!'});
    assert.equal(login.status,200);
    assert.equal(login.data.mustChangePassword,true,'one-time default forces password setup');
    const sid=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await req('/api/admin/dashboard','GET',undefined,sid)).status,403,'setup required first');
    const changed=await req('/api/admin/password-change','POST',{newPassword:'unique-secure-admin-pass-2026'},sid);
    assert.equal(changed.status,200);
    assert.ok(fs.existsSync(path.join(temp,'data','admin-auth.json')));
    const newCookie=changed.headers.get('set-cookie').split(';')[0];
    assert.equal((await req('/api/admin/dashboard','GET',undefined,newCookie)).status,200);
    assert.equal((await req('/api/admin/login','POST',{username:'admin',password:'Barber123!'})).status,401,'default no longer works');
    assert.equal((await req('/api/admin/login','POST',{username:'admin',password:'unique-secure-admin-pass-2026'})).status,200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'data','db.json'),'utf8')).bookings[0].id,'old-booking');
  } finally {server.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
});


test('public website has final Gavro media and no public cancellation UI',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const db=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','db.json'),'utf8'));
  assert.ok(!html.includes('id="successCancel"'),'booking success no longer offers public cancel');
  assert.ok(!html.includes('id="cancelForm"'),'cancellation form removed');
  assert.ok(html.includes('hairstyle_by_gavro/'),'official Instagram profile linked');
  assert.ok(html.includes('Dblwri_kXOv'),'final video post linked');
  assert.ok(html.includes('DLVC9ChNF4G/embed/'),'requested Instagram image post included');
  assert.ok(html.includes('/uploads/gavro-featured-reel.mp4'),'uploaded local video embedded');
  assert.ok(!/addToCalendar|calendar\.google|\.ics|Moj termin|Moji termini|Otkaži termin/i.test(html+app),'no calendar export, my-bookings, or public cancel UI');
  assert.equal(db.settings.instagram,'https://www.instagram.com/hairstyle_by_gavro/');
  assert.equal(db.gallery.length,3);
});
