const KEY='irongateInspections';
let currentId=null;

function getInspections(){return JSON.parse(localStorage.getItem(KEY)||'[]');}
function saveInspections(v){localStorage.setItem(KEY,JSON.stringify(v));}

function generateInspectionNumber(){
 const year=new Date().getFullYear();
 const items=getInspections().filter(x=>x.number?.startsWith('IG-'+year));
 return `IG-${year}-${String(items.length+1).padStart(4,'0')}`;
}

function renderList(){
 const list=document.getElementById('inspectionList');
 list.innerHTML='';
 getInspections().forEach(i=>{
  const d=document.createElement('div');
  d.className='card';
  d.innerHTML=`<strong>${i.number}</strong><br>${i.owner||''}<br>${i.address||''}
  <br><button data-id="${i.id}">Open</button>`;
  d.querySelector('button').onclick=()=>openInspection(i.id);
  list.appendChild(d);
 });
}

function openInspection(id){
 const i=getInspections().find(x=>x.id===id);
 if(!i)return;
 currentId=id;
 editor.style.display='block';
 inspectionNumber.value=i.number;
 ownerName.value=i.owner||'';
 propertyAddress.value=i.address||'';
}

newInspectionBtn.onclick=()=>{
 currentId=Date.now().toString();
 editor.style.display='block';
 inspectionNumber.value=generateInspectionNumber();
 ownerName.value='';
 propertyAddress.value='';
};

saveBtn.onclick=()=>{
 const items=getInspections();
 const obj={
  id:currentId||Date.now().toString(),
  number:inspectionNumber.value,
  owner:ownerName.value,
  address:propertyAddress.value
 };
 const idx=items.findIndex(x=>x.id===obj.id);
 if(idx>=0) items[idx]=obj; else items.push(obj);
 saveInspections(items);
 renderList();
 alert('Saved');
};

renderList();
