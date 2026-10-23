const test=require('node:test');
const assert=require('node:assert/strict');
const {Window}=require('happy-dom');
const {installEnhancedMeasurement}=require('../dist/enhanced.js');
const {getOrCreateGoogleTag}=require('../dist/gtag.js');
function browser(url='https://desktop.example.com/') {
 const window=new Window({url,settings:{disableJavaScriptFileLoading:true,handleDisabledFileLoadingAsSuccess:true}});
 Object.assign(globalThis,{window,document:window.document,history:window.history});
 const gtag=getOrCreateGoogleTag();
 return{window,events:()=>window.dataLayer.map(x=>Array.from(x)),install:options=>installEnhancedMeasurement(options,'https://desktop.example.com',()=>window.location.pathname,(name,params)=>gtag('event',name,params))};
}
test('user retains native site-search collection and route changes without reading app input',()=>{
 // Given a native GA4 URL search and real DOM history.
 const b=browser('https://desktop.example.com/?q=boots');const stop=b.install({siteSearch:true});
 // When the user navigates to another result page.
 history.pushState({},'', '/results?search=socks');stop();history.pushState({},'', '/results?search=ignored');
 // Then only URL-derived terms before teardown enter the public event queue.
 assert.deepEqual(b.events(),[['event','view_search_results',{search_term:'boots'}],['event','view_search_results',{search_term:'socks'}]]);b.window.happyDOM.abort();
});
test('user retains full outbound-link and download metadata in native mode',()=>{
 // Given a real external PDF link.
 const b=browser();const stop=b.install({outboundClicks:true,fileDownloads:true});const link=document.createElement('a');link.href='https://files.example.com/report.pdf?edition=2';link.id='download';link.className='resource';link.textContent='Report';document.body.append(link);link.addEventListener('click',e=>e.preventDefault());
 // When the user clicks that link.
 link.dispatchEvent(new b.window.MouseEvent('click',{bubbles:true,cancelable:true}));
 // Then native URL, name and link properties survive the adapter.
 assert.deepEqual(b.events(),[['event','file_download',{file_extension:'pdf',file_name:'report.pdf',link_url:link.href,link_id:'download',link_text:'Report'}],['event','click',{outbound:true,link_domain:'files.example.com',link_url:link.href,link_id:'download',link_classes:'resource'}]]);stop();b.window.happyDOM.abort();
});
test('user retains automatic unmarked form measurement in native mode',()=>{
 // Given a normal form without library-specific markers.
 const b=browser();const stop=b.install({forms:true});const form=document.createElement('form');form.id='signup';const input=document.createElement('input');form.append(input);document.body.append(form);
 // When the user enters and submits the form without sending any field value.
 input.dispatchEvent(new b.window.FocusEvent('focusin',{bubbles:true}));form.dispatchEvent(new b.window.Event('submit',{bubbles:true,cancelable:true}));
 // Then the standard form events carry only form metadata.
 assert.deepEqual(b.events(),[['event','form_start',{form_id:'signup'}],['event','form_submit',{form_id:'signup'}]]);stop();b.window.happyDOM.abort();
});
test('user can explicitly retain the redacted desktop policy',()=>{
 // Given an app opts into origin-only URLs and marked forms.
 const b=browser('https://desktop.example.com/?q=private');const stop=b.install({privacy:'redacted',outboundClicks:true,forms:true,siteSearch:true});const form=document.createElement('form');document.body.append(form);const link=document.createElement('a');link.href='https://external.example.com/private?token=secret';document.body.append(link);link.addEventListener('click',e=>e.preventDefault());
 // When an unmarked form submits and an external link is clicked.
 form.dispatchEvent(new b.window.Event('submit',{bubbles:true}));link.dispatchEvent(new b.window.MouseEvent('click',{bubbles:true,cancelable:true}));
 // Then only the approved origin is collected and private search/form data stays absent.
 assert.deepEqual(b.events(),[['event','click',{outbound:true,link_domain:'external.example.com',link_url:'https://external.example.com'}]]);stop();b.window.happyDOM.abort();
});
