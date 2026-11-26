# IronGate Google Search follow-up

This SEO release uses `https://irongatepool.com.au/booking/` as the sole booking goal. The existing Firebase calendar, checkout and payment logic are unchanged.

The homepage, inspector and booking landing pages now have unique titles, descriptions and social metadata. The booking page is indexable and included in the XML sitemap; private admin and payment-confirmation pages remain excluded. The site uses a new square PNG favicon that meets Google's published size/shape guidelines.

## Google account steps — not editable from GitHub

1. Open Google Business Profile. If the **Booking** transaction link feature is available, enter `https://irongatepool.com.au/booking/` and set it as **Business preferred**.
2. Open Google Search Console > Sitemaps and submit `https://irongatepool.com.au/sitemap.xml`.
3. Use URL Inspection on `/`, `/pool-safety-inspector-brisbane/`, and `/booking/` to inspect the currently indexed versions and request recrawling when needed.
4. Run https://search.google.com/test/rich-results on the homepage and inspector page. The existing LocalBusiness/Service JSON-LD remains in place and is checked by the site's regression tests.
5. Monitor Search Console impressions and click-through rate, then measure completed calendar bookings separately from mere page views. Indexing and favicons in Google results aren't guaranteed.

Google's current documentation: https://developers.google.com/search/docs/appearance/favicon-in-search and https://support.google.com/business/answer/6218037?hl=en-AU
