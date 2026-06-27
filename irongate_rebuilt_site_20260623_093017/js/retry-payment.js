import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const retryButton = document.querySelector("#retry-payment-button");
const retryMessage = document.querySelector("#retry-payment-message");
const bookingReference = document.querySelector("#booking-reference");
const params = new URLSearchParams(window.location.search);
const bookingId = params.get("bookingId") || "";
const functions = getFunctions(app, "us-central1");
const createBookingCheckoutSession = httpsCallable(functions, "createBookingCheckoutSession");

function setMessage(text, type = "") {
  if (!retryMessage) return;
  retryMessage.textContent = text;
  retryMessage.dataset.type = type;
}

function buildPageUrl(path) {
  const url = new URL(path, window.location.origin);
  if (bookingId) url.searchParams.set("bookingId", bookingId);
  return url.toString();
}

if (bookingReference && bookingId) {
  bookingReference.textContent = bookingId;
}

if (retryButton) {
  if (!bookingId) {
    retryButton.href = "/booking/";
    retryButton.textContent = "Start a New Booking";
  } else {
    retryButton.addEventListener("click", async (event) => {
      event.preventDefault();
      retryButton.textContent = "Opening secure payment...";
      retryButton.setAttribute("aria-disabled", "true");
      setMessage("Opening secure Stripe payment...", "success");

      try {
        const result = await createBookingCheckoutSession({
          bookingId,
          successUrl: buildPageUrl("/success/"),
          cancelUrl: buildPageUrl("/cancelled/")
        });

        const checkoutUrl = result?.data?.checkoutUrl;
        if (!checkoutUrl) throw new Error("Stripe Checkout URL was not returned.");
        window.location.assign(checkoutUrl);
      } catch (error) {
        console.error("Retry payment error:", error);
        retryButton.textContent = "Try Payment Again";
        retryButton.removeAttribute("aria-disabled");
        setMessage("Payment could not reopen. Please call IronGate on 0481 442 260 or start a new booking.", "error");
      }
    });
  }
}
