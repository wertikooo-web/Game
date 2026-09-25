(()=>{
  function fieldValue(ids, fallbackSelector='') {
    for (const id of ids) {
      const el=document.getElementById(id);
      if (el && typeof el.value==='string') return el.value.trim();
    }
    const el=fallbackSelector?document.querySelector(fallbackSelector):null;
    return el && typeof el.value==='string'?el.value.trim():'';
  }

  window.createRoom=async function(){
    try{
      const name=fieldValue(['hostName','playerName','name'],'#app input[type="text"], #app input:not([type])');
      if(!name){
        const input=document.getElementById('hostName')||document.querySelector('#app input[type="text"], #app input:not([type])');
        if(input){ input.focus(); input.scrollIntoView({behavior:'smooth',block:'center'}); }
        return;
      }

      S.name=name;
      const mode=document.getElementById('mode');
      const level=document.getElementById('level');
      const rounds=document.getElementById('rounds');
      S.mode=mode?.value||S.mode||'solo';
      S.level=level?.value||S.level||'light';
      S.rounds=Number(rounds?.value||S.rounds||15);
      S.picked=questions();

      if(!S.picked.length){
        console.error('No questions available for deck',S.level);
        return alert('В этой колоде пока нет вопросов');
      }

      const j=await api('create',{name:S.name,mode:S.mode,level:S.level,rounds:S.rounds});
      S.room=j.room;
      S.player=j.player;
      S.players=[j.player];
      S.host=true;
      S.screen='lobby';
      save();
      render();
      syncLoop();
    }catch(e){
      console.error('createRoom failed',e);
      alert(e?.message||'Не удалось создать комнату');
    }
  };
})();