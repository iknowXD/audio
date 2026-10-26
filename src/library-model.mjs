export const normalized=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
export const artistName=track=>track.artist?.trim()||'Неизвестный артист';
export const artistKey=track=>'artist:'+normalized(artistName(track));
export const albumName=track=>track.album?.trim()||'Без альбома';
export const albumKey=track=>'album:'+JSON.stringify([normalized(track.albumArtist||artistName(track)),normalized(albumName(track))]);
export function groupTracks(tracks,kind){
 const map=new Map(),keyOf=kind==='artist'?artistKey:albumKey;
 for(const track of tracks){const id=keyOf(track);if(!map.has(id))map.set(id,{id,kind,name:kind==='artist'?artistName(track):albumName(track),artist:track.albumArtist||artistName(track),tracks:[]});map.get(id).tracks.push(track);}
 for(const group of map.values())group.tracks.sort((a,b)=>(a.discNo||1)-(b.discNo||1)||(a.trackNo||0)-(b.trackNo||0)||a.added-b.added);
 return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
}
export function playlistTracks(playlist,tracks){const byId=new Map(tracks.map(t=>[t.id,t]));return [...new Set(playlist.trackIds||[])].map(id=>byId.get(id)).filter(Boolean);}
export function matches(track,query){return !normalized(query)||normalized([track.title,track.artist,track.album,track.genre].join(' ')).includes(normalized(query));}
export function durationLabel(seconds){if(!Number.isFinite(seconds)||seconds<=0)return '—';const n=Math.floor(seconds);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
export function recentBucket(timestamp,now=new Date()){
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),age=(start-timestamp)/86400000;
 return age<0?'Сегодня':age<1?'Вчера':age<7?'На этой неделе':age<30?'В этом месяце':'Ранее';
}

export function countLabel(number,forms=['песня','песни','песен']){const n=Math.abs(number)%100,i=n%10;return `${number} ${forms[n>10&&n<20?2:i===1?0:i>=2&&i<=4?1:2]}`;}
