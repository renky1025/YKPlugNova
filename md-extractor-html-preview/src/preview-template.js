export const getPreviewHTML = (markdownHtml, theme) => {
  // If no theme matches, fallback to a clean default
  let head = '';
  let bodyClass = '';
  let wrapper = `<div class="content">${markdownHtml}</div>`;

  if (theme === 'editorial') {
    head = `
      <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>
        :root { --bg: #fdfcf8; --text: #1a1a1a; --accent: #c92a2a; }
        body { margin: 0; padding: 40px; background: var(--bg); color: var(--text); font-family: 'Noto Serif SC', 'Playfair Display', serif; display: flex; justify-content: center; }
        .content { max-width: 680px; width: 100%; line-height: 1.8; font-size: 18px; letter-spacing: 0.02em; }
        h1 { font-family: 'Playfair Display', serif; font-size: 3.5rem; line-height: 1.1; margin: 0 0 40px 0; font-weight: 700; text-align: center; text-transform: capitalize; border-bottom: 2px solid var(--text); padding-bottom: 20px; }
        h2 { font-size: 1.8rem; margin: 40px 0 20px 0; font-weight: 700; color: var(--accent); display: flex; align-items: center; }
        h2::before { content: ""; display: inline-block; width: 30px; height: 2px; background: var(--accent); margin-right: 15px; }
        p { margin: 0 0 24px 0; text-align: justify; }
        /* Drop cap for first paragraph */
        .content > p:first-of-type::first-letter { float: left; font-size: 4.5rem; line-height: 0.8; margin: 8px 12px 0 0; color: var(--accent); font-family: 'Playfair Display', serif; font-weight: bold; }
        img { width: 100%; height: auto; border-radius: 4px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); margin: 30px 0; filter: contrast(1.05) sepia(0.1); }
        blockquote { border-left: 1px solid var(--accent); margin: 30px 0; padding: 20px 30px; font-style: italic; font-size: 1.2rem; background: rgba(201, 42, 42, 0.03); }
        a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }
      </style>
    `;
    bodyClass = 'editorial';
  } 
  else if (theme === 'swiss-deck') {
    head = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        :root { --red: #ff3333; --black: #0f0f0f; --white: #ffffff; }
        body { margin: 0; padding: 0; background: var(--black); color: var(--white); font-family: 'Inter', sans-serif; overflow-x: hidden; }
        .content { width: 100%; padding: 5vw; }
        h1 { font-size: 8vw; font-weight: 900; line-height: 0.9; margin: 0 0 40px 0; letter-spacing: -0.04em; color: var(--white); text-transform: uppercase; border-top: 10px solid var(--red); padding-top: 20px; }
        h2 { font-size: 4vw; font-weight: 700; line-height: 1.1; margin: 80px 0 30px 0; color: var(--red); letter-spacing: -0.02em; }
        p { font-size: 2vw; line-height: 1.5; margin: 0 0 30px 0; font-weight: 400; max-width: 80%; }
        strong { color: var(--red); }
        img { width: 100%; max-width: 100%; border: 4px solid var(--red); mix-blend-mode: luminosity; }
        blockquote { font-size: 3vw; font-weight: 700; margin: 60px 0; padding-left: 30px; border-left: 10px solid var(--red); letter-spacing: -0.02em; }
        ul { padding: 0; list-style: none; }
        li { font-size: 2vw; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 15px; }
        li::before { content: "■"; color: var(--red); margin-right: 15px; }
        /* Add deck-like paging lines */
        .content { border-left: 1px solid rgba(255,255,255,0.1); border-right: 1px solid rgba(255,255,255,0.1); max-width: 1440px; margin: 0 auto; min-height: 100vh; position: relative; }
        .content::before { content: ""; position: absolute; top: 0; left: 50%; width: 1px; height: 100%; background: rgba(255,255,255,0.05); z-index: -1; }
      </style>
    `;
    bodyClass = 'swiss-deck';
  }
  else if (theme === 'poster-neon') {
    head = `
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">
      <style>
        :root { --bg: #050510; --primary: #00ffcc; --secondary: #ff00ff; }
        body { margin: 0; padding: 0; background: var(--bg); display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: 'Space Grotesk', sans-serif; }
        .card-wrapper { background: linear-gradient(135deg, rgba(0,255,204,0.1) 0%, rgba(255,0,255,0.1) 100%); padding: 40px; border-radius: 24px; box-shadow: 0 0 40px rgba(0,255,204,0.2), inset 0 0 20px rgba(255,0,255,0.1); width: 480px; position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
        .card-wrapper::before { content: ""; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 50%); mix-blend-mode: overlay; pointer-events: none; }
        .content { position: relative; z-index: 1; color: #fff; }
        h1 { font-size: 3rem; margin: 0 0 20px 0; background: -webkit-linear-gradient(45deg, var(--primary), var(--secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-transform: uppercase; font-weight: 700; letter-spacing: -1px; }
        h2 { font-size: 1.5rem; color: var(--primary); margin: 30px 0 15px 0; font-weight: 400; }
        p { font-size: 1rem; line-height: 1.6; color: rgba(255,255,255,0.8); margin: 0 0 20px 0; }
        img { width: 100%; border-radius: 12px; margin: 20px 0; border: 2px solid rgba(255,255,255,0.1); }
        code { background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px; color: var(--primary); border: 1px solid rgba(0,255,204,0.3); }
        pre { background: rgba(0,0,0,0.5); padding: 15px; border-radius: 12px; overflow: auto; border: 1px solid rgba(255,255,255,0.1); }
      </style>
    `;
    wrapper = `<div class="card-wrapper"><div class="content">${markdownHtml}</div></div>`;
    bodyClass = 'poster-neon';
  }
  else {
    // Clean minimal default (similar to what we had)
    head = `
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: #ffffff; color: #333; padding: 30px; line-height: 1.6; }
        .content { max-width: 800px; margin: 0 auto; }
        h1, h2, h3 { color: #111; margin-top: 1.5em; }
        h1 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        img { max-width: 100%; border-radius: 6px; }
        pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
        code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; background: rgba(175,184,193,0.2); padding: 0.2em 0.4em; border-radius: 6px; font-size: 85%; }
        pre code { background: transparent; padding: 0; }
        blockquote { padding: 0 1em; color: #57606a; border-left: 0.25em solid #d0d7de; margin: 0; }
      </style>
    `;
    bodyClass = 'default';
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${head}
</head>
<body class="${bodyClass}">
  ${wrapper}
</body>
</html>`.trim();
};
