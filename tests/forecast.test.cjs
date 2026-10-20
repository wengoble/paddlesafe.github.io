// Run from the repository root: node --test tests/forecast.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
function app(){
  const elements={};
  const ctx=vm.createContext({localStorage:{getItem:()=>null},document:{getElementById:id=>elements[id]??=( {innerHTML:'',style:{}} ),querySelectorAll:()=>[]},console});
  // Evaluate the actual application functions, excluding startup/network timers.
  vm.runInContext(script.slice(0,script.lastIndexOf("rDT('hDT',0")),ctx);
  ctx.elements=elements;
  return ctx;
}
function seed(c){
  c.SPOTS=[{id:'test',n:'Test beach',t:'Test',lake:false,exposed:false,tips:[]}];
  const array=v=>Array(120).fill(v);
  c.wCache={0:{hourly:{time:array('time'),wind_speed_10m:array(3),wind_gusts_10m:array(4),wind_direction_10m:array(0),temperature_2m:array(20),weather_code:array(0),precipitation:array(0),precipitation_probability:array(0),visibility:array(10000)}}};
  c.mCache={0:{hourly:{time:array('time'),wave_height:array(0.2),wave_period:array(8),swell_wave_height:array(0.1),sea_surface_temperature:array(20)}}};
  c.ready=true;
}
for(const skill of ['beginner','intermediate']){
  test(`${skill}: missing marine data is unknown, never GOOD`,()=>{
    const c=app();seed(c);c.skillLevel=skill;c.mCache[0]=null;
    const f=c.getForecast(0,0);
    for(const slot of f){assert.equal(slot.sh,null);assert.equal(slot.sp,null);assert.equal(slot.rating,'CAUTION');assert.equal(slot.confidence,'Low');assert.match(slot.factors[0],/wave height/)}
    const d=c.buildDaySummary(f);assert.equal(d.dayRating,'CAUTION');assert.match(d.bestWindow,/No reliable window/);
    assert.match(c.buildCardHTML(c.SPOTS[0],0,0),/Unavailable/);
    c.renderHome();assert.doesNotMatch(c.elements.tpW.innerHTML,/TOP PICK/);
    c.cur=0;c.renderDetail();assert.match(c.elements.dMet.innerHTML,/Unavailable/);assert.doesNotMatch(c.elements.fB.innerHTML,/null|NaN/);
  });
  test(`${skill}: absent, null, invalid and truncated wind measurements`,()=>{
    for(const field of ['wind_speed_10m','wind_gusts_10m'])for(const value of [null,undefined,NaN,Infinity,-1,'0']){
      const c=app();seed(c);c.skillLevel=skill;c.wCache[0].hourly[field]=Array(7).fill(value);
      const f=c.getForecast(0,0);for(const slot of f){assert.notEqual(slot.rating,'GOOD');assert.equal(slot[field==='wind_speed_10m'?'ws':'gs'],null)}
    }
  });
  test(`${skill}: zero is valid calm data and lakes need no marine API`,()=>{
    const c=app();seed(c);c.skillLevel=skill;
    for(const key of ['wind_speed_10m','wind_gusts_10m'])c.wCache[0].hourly[key].fill(0);
    c.mCache[0].hourly.wave_height.fill(0);c.mCache[0].hourly.wave_period.fill(0);
    assert.equal(c.getForecast(0,0)[2].rating,'GOOD');assert.equal(c.getForecast(0,0)[2].ws,0);
    c.SPOTS[0].lake=true;c.mCache[0]=null;assert.equal(c.getForecast(0,0)[2].rating,'GOOD');
  });
}
test('known dangerous gusts or swell retain AVOID with other data missing',()=>{
  const c=app();seed(c);c.mCache[0]=null;c.wCache[0].hourly.wind_gusts_10m.fill(30);
  assert.equal(c.getForecast(0,0)[2].rating,'AVOID');
  seed(c);c.wCache[0].hourly.wind_speed_10m.fill(null);c.mCache[0].hourly.wave_height.fill(2);
  assert.equal(c.getForecast(0,0)[2].rating,'AVOID');
});
test('partial marine samples and missing context block GOOD for affected slots',()=>{
  for(const field of ['wave_height','wave_period']){
    const c=app();seed(c);c.mCache[0].hourly[field][12]=null;
    const f=c.getForecast(0,0);assert.equal(f[1].rating,'GOOD');assert.equal(f[2].rating,'CAUTION');assert.notEqual(c.buildDaySummary(f).dayRating,'GOOD');
  }
  for(const field of ['wind_direction_10m','weather_code']){
    const c=app();seed(c);delete c.wCache[0].hourly[field];assert.equal(c.getForecast(0,0)[2].rating,'CAUTION');
  }
});
test('missing measurements sort after known calm measurements',()=>{
  const c=app();seed(c);c.SPOTS.push({...c.SPOTS[0],id:'other'});c.wCache[1]=structuredClone(c.wCache[0]);c.mCache[1]=structuredClone(c.mCache[0]);
  c.wCache[0].hourly.wind_speed_10m.fill(null);c.mCache[0]=null;
  for(const sort of ['wind','swell','calm','best']){c.srt=sort;assert.equal(c.sorted()[0].i,1)}
});
test('failed weather refresh clears previously displayed detail',()=>{
  const c=app();seed(c);c.cur=0;c.renderDetail();c.wCache[0]=null;c.renderDetail();assert.match(c.elements.dH.innerHTML,/unavailable/);assert.equal(c.elements.fB.innerHTML,'');assert.match(c.buildCardHTML(c.SPOTS[0],0,0),/unavailable/);
});
test('fetch failures, HTTP errors, malformed JSON and API errors clear caches; recovery works',async()=>{
  const c=app();seed(c);
  for(const failure of ['network','http','json','schema']){
    c.fetch=async url=>{
      if(!url.includes('marine-api'))return {ok:true,json:async()=>c.wCache[0]};
      if(failure==='network')throw Error('offline');
      return {ok:failure!=='http',status:503,json:async()=>{if(failure==='json')throw Error('invalid JSON');return {error:true}}};
    };
    await c.fetchAll();assert.equal(c.mCache[0],null);assert.equal(c.getForecast(0,0)[2].rating,'CAUTION');
  }
  seed(c);const weather=c.wCache[0],marine=c.mCache[0];c.mCache[0]=null;
  c.fetch=async url=>({ok:true,json:async()=>url.includes('marine-api')?marine:weather});
  await c.fetchAll();assert.equal(c.getForecast(0,0)[2].rating,'GOOD');
});
test('normal forecasts retain all original beginner/intermediate thresholds and ratings',()=>{
  const c=app();const neutral={strength:0};
  for(const skill of ['beginner','intermediate'])for(const exposed of [false,true])for(const lake of [false,true]){
    const expected=skill==='intermediate'?(exposed?[14,9,20,15]:[16,11,22,16]):(exposed?[10,6,15,11]:[12,8,17,12]);
    assert.deepEqual(Object.values(c.skillThresholds(exposed,skill)),expected);
    for(const wind of [0,6,8,9,10,11,12,14,16,17])for(const gust of [0,11,12,15,16,17,20,22,23])for(const wave of [0,0.3,0.4,0.5,0.7,0.9,1.2,1.3]){
      const args=[wind,gust,wave,8,0,0,0,10000,exposed,lake,0,20,20,neutral,skill];
      const original=c.rateAvailableSlot(...args),patched=c.rateSlot(...args);
      assert.equal(patched.rating,original.rating);assert.equal(patched.confidence,original.confidence);
    }
  }
});
