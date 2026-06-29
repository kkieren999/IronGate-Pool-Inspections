window.ironGateBookingContext = { customerType: "homeowner", bookingRole: "Homeowner" };

const style = document.createElement("style");
style.textContent = ".calendar-header-row{display:grid!important;grid-template-columns:46px minmax(0,1fr) 46px;align-items:center;gap:12px}.calendar-header-row h3,#calendar-title{text-align:center;margin:0!important}.calendar-nav-btn{width:46px!important;height:46px!important;padding:0!important;display:inline-grid!important;place-items:center!important;border-radius:999px!important}";
document.head.appendChild(style);

document.querySelectorAll(".booking-note").forEach((note)=>{if((note.textContent||"").toLowerCase().includes("availability manager"))note.remove();});
const heading=document.querySelector("#contact-details-heading");
if(heading) heading.textContent="Homeowner contact details";
