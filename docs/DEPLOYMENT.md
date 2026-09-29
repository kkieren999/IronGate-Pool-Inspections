# Build and deployment

1. Review PR checks, the diff and all public route redirects before merging.
2. Run Node 22 verification and static build commands from README.md.
3. Manually test payment in Stripe test mode, webhook confirmation, email, slot locking, calendar events and private invitations in an appropriate environment. Static checks do not test external integrations.
4. Inventory deployed Firebase functions/extensions before decommissioning an old trigger; deleting a source export does not delete the cloud resource.
5. Check actual live Storage rules before running the separate manual Storage rules deploy.

static.yml builds website/ to public/, copies root CNAME and publishes that artifact. It no longer patches old prices or licence placeholders during deploy. The PR verification workflow builds but never deploys.

Main-branch workflows deploy payments, email, calendar, availability and Firestore rules with their separate codebases. The default functions/ codebase is not automatically deployed by the current workflows; its old cloud functions require a manual audit. Storage rules have a manual-only workflow; the previous automatic workflow deployed only Firestore.

Reverting a merge restores Git source; it does not undo Stripe payments, Firestore documents, or deployed cloud resources.
