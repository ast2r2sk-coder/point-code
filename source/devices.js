'use strict';
// One device list for the preview toolbar and the Screens board.
// Sizes are CSS (logical) viewports, not physical pixels: the page lays out at this width, then the frame is scaled.
// Galaxy Fold values follow the Chrome DevTools "Galaxy Z Fold 5" preset; Flip values are physical size / DPR (approximate).
const DEVICES = [
  {id:'desktop',group:'데스크톱',label:'Desktop',w:1440,h:900},
  {id:'laptop',group:'데스크톱',label:'Laptop',w:1280,h:800},
  {id:'tablet',group:'태블릿',label:'iPad',w:768,h:1024},
  {id:'iphone',group:'모바일',label:'iPhone',w:390,h:844},
  {id:'android',group:'모바일',label:'Android',w:412,h:915},
  {id:'flip-cover',group:'플립',label:'Flip 커버',w:360,h:374,approx:true},
  {id:'flip',group:'플립',label:'Flip 펼침',w:412,h:1004,approx:true},
  {id:'fold-cover',group:'폴드',label:'Fold 커버',w:344,h:882},
  {id:'fold',group:'폴드',label:'Fold 펼침',w:882,h:1104}
];
// Ids used before 0.6.0, so a saved board state keeps its device.
const LEGACY = {mobile:'iphone'};
module.exports = {DEVICES,LEGACY};
