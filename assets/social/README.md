# Social artwork

`homepage-social.png` is the approved 1200×630 image shared by orb-ui.com, the
repository README, and the Experimental Software gallery.

Run `pnpm generate:og` to copy this exact image to `demo/public/og-image-v3.png`.
The homepage and docs use that URL for both Open Graph and Twitter cards. The
versioned filename lets sharing services discover the updated artwork.

`design.html` preserves the editable layout. Its `homepage-orb.png` is an unchanged
capture of the actual orb-ui.com cloud-theme canvas, captured at retina resolution
in manual speaking mode at volume 1 on September 20, 2026. The orb is not
AI-generated; the surrounding typography and layout were composed in HTML/CSS.

The approved PNG is preserved directly to avoid font-rendering differences when
exporting on another machine. After approving a future layout change, replace the
PNG, then run `pnpm generate:og` to synchronize the website export.
