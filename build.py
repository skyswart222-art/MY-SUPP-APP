#!/usr/bin/env python3
"""Builds index.html and app.js from planner.html (the Claude artifact version), so both stay in step.
Run: python3 build.py"""
import re, sys, pathlib
here = pathlib.Path(__file__).parent
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else here / "source" / "planner.html").read_text()
start = src.index("<script>\n"); end = src.rindex("</script>")
head, body_js, tail = src[:start], src[start + len("<script>\n"):end], src[end + len("</script>"):]
style_end = head.index("</style>") + len("</style>")
styles, markup = head[:style_end], head[style_end:]
styles = re.sub(r'<meta name="claude:[^>]*>\n?', "", styles)
assert "<title>" in styles
# Header: add the profile button before the theme button.
needle = '<button class="iconbtn" id="themebtn"'
assert needle in markup
markup = markup.replace(needle, '<button class="avatarbtn" id="avatarbtn" type="button" aria-label="Your profile" hidden></button>' + needle, 1)
# Photos: private photos are shown through signed links (auth.js provides window.__blobSrc).
old = 'function storedSrc(ref) { if (!ref) return null; return'
assert old in body_js
body_js = body_js.replace(old, 'function storedSrc(ref) { if (!ref) return null; if (window.__blobSrc && !/^(data:|blob:|https?:|\\/)/.test(ref)) return window.__blobSrc(ref); return', 1)
index = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Planner">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-180.png">
{styles}
<link rel="stylesheet" href="auth.css">
</head>
<body>
{markup.strip()}
<script src="config.js"></script>
<script src="vendor/supabase.js"></script>
<script src="auth.js"></script>
</body>
</html>
"""
(here / "index.html").write_text(index)
(here / "app.js").write_text("/* Built from planner.html by build.py. Edit planner.html, then run build.py again. */\n" + body_js)
print("index.html", len(index), "app.js", len(body_js))
