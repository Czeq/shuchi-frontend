const fs = require('fs');
const path = require('path');
const https = require('https');

// Supabase Configuration matching cart.js
const SUPABASE_PROJECT_ID = "okprwbzfsyvrkpygjkum";
const SUPABASE_KEY = "sb_publishable_LAgGxlaltxGIe6wWu1DBkQ_PJN0DLNG";
const HOST = `${SUPABASE_PROJECT_ID}.supabase.co`;
const PATH = "/rest/v1/products?select=*";

console.log("🚀 Starting Jamstack Pre-rendering Build...");

// 1. Fetch products from Supabase REST API natively
const options = {
  hostname: HOST,
  path: PATH,
  method: 'GET',
  headers: {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  }
};

const req = https.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      if (res.statusCode !== 200) {
        throw new Error(`Failed to fetch: HTTP ${res.statusCode}. Body: ${body}`);
      }

      const products = JSON.parse(body);
      console.log(`✅ Loaded ${products.length} products from database.`);
      
      runGenerator(products);
    } catch (e) {
      console.error("❌ Build error:", e);
      process.exit(1);
    }
  });
});

req.on('error', err => {
  console.error("❌ Network error fetching database records:", err);
  process.exit(1);
});
req.end();

function getBaseProductId(id) {
  if (!id) return '';
  return id.replace(/-\d+$/, '');
}

function runGenerator(products) {
  // --- A. GENERATE STATIC PRODUCT DETAILS PAGES ---
  const productTemplatePath = path.join(__dirname, 'product.html');
  if (!fs.existsSync(productTemplatePath)) {
    console.error("❌ Base product.html template not found!");
    process.exit(1);
  }

  const baseProductHtml = fs.readFileSync(productTemplatePath, 'utf8');

  products.forEach(product => {
    const id = product.id;
    const title = product.title || '[Product Title]';
    const brand = product.brand || '[Brand Name]';
    const price = product.price || 0;
    const desc = product.desc || '';
    const skinType = product.skin_type || '';
    const volumeVal = product.volume ? `${product.volume} ${product.volume_unit || ''}`.trim() : '';
    const image = product.img || '';

    console.log(`📄 Pre-rendering page for product: ${id}...`);

    let html = baseProductHtml;

    // Replace page Title and SEO metadata
    html = html.replace(/<title>\[Product Name\]/g, `<title>${title}`);
    
    // Replace product ID placeholder
    html = html.replace(/<!-- PRODUCT_ID -->/g, id);

    // Replace HTML content placeholders
    html = html.replace(
      /<p class="p-brand" id="brandPlaceholder">\[Brand Name\]<\/p>/g,
      `<p class="p-brand" id="brandPlaceholder">${brand}</p>`
    );
    html = html.replace(
      /<h1 class="p-title" id="titlePlaceholder">\[Product Title\]<\/h1>/g,
      `<h1 class="p-title" id="titlePlaceholder">${title}</h1>`
    );
    html = html.replace(
      /<p class="p-price" id="pricePlaceholder">\[Price\]<\/p>/g,
      `<p class="p-price" id="pricePlaceholder">৳ ${price}</p>`
    );
    html = html.replace(
      /<button class="btn-primary">Add to Bag — \[Price\]<\/button>/g,
      `<button class="btn-primary" onclick="addToCart('${id}', '${title.replace(/'/g, "\\'")}', '${brand.replace(/'/g, "\\'")}', ${price}, '${image}')">Add to Bag — ৳ ${price}</button>`
    );
    html = html.replace(
      /<p class="p-desc" id="descPlaceholder">\[Product Description Paragraph. Highlight what it does, texture, and why it matters.\]<\/p>/g,
      `<p class="p-desc" id="descPlaceholder">${desc}</p>`
    );
    html = html.replace(
      /<span class="meta-value" id="skinTypePlaceholder">\[Target Skin Types\]<\/span>/g,
      `<span class="meta-value" id="skinTypePlaceholder">${skinType}</span>`
    );
    html = html.replace(
      /<span class="meta-value" id="volumePlaceholder">\[Size\/Volume\]<\/span>/g,
      `<span class="meta-value" id="volumePlaceholder">${volumeVal}</span>`
    );

    // Inject static image if defined
    if (image) {
      const staticImageHTML = `<img src="${image}" alt="${title}" class="phero-svg" style="width: 100%; height: 100%; object-fit: contain;" onerror="handleDetailImgError(this)">`;
      html = html.replace(
        /<!-- SVG Placeholder for Product -->[\s\S]*?<\/svg>/g,
        staticImageHTML
      );
    }

    // Write the output file
    fs.writeFileSync(path.join(__dirname, `${id}.html`), html, 'utf8');
  });

  // --- B. PRE-RENDER STOREFRONT STATIC CARDS ---
  const storefrontTemplatePath = path.join(__dirname, 'storefront.html');
  if (fs.existsSync(storefrontTemplatePath)) {
    console.log("🏪 Pre-rendering storefront catalog cards...");
    let storefrontHtml = fs.readFileSync(storefrontTemplatePath, 'utf8');
    const seenBaseIds = new Set();
    const uniqueStorefrontProducts = [];
    products.forEach(p => {
      const baseId = getBaseProductId(p.id);
      if (!seenBaseIds.has(baseId)) {
        seenBaseIds.add(baseId);
        uniqueStorefrontProducts.push(p);
      }
    });

    const cardsHtml = uniqueStorefrontProducts.map(p => {
      const pImage = p.img || '';
      const pTitle = p.title || '[Product Title]';
      const pBrand = p.brand || '[Brand]';
      const pDesc = p.desc || '';
      const pPrice = p.price || '';

      const imgHTML = pImage ? 
        `<img src="${pImage}" alt="${pTitle}" style="width: 100%; height: 100%; object-fit: contain; padding: 1.5rem; display: block;" onerror="handleImgError(this)">` :
        `<svg width="50" height="76" viewBox="0 0 50 76" fill="none">
          <rect x="11" y="8" width="28" height="62" rx="4" fill="#A8C4A2" opacity="0.5"/>
          <rect x="16" y="3" width="18" height="8" rx="2" fill="#6B8F6B" opacity="0.4"/>
          <rect x="13" y="34" width="24" height="1.5" fill="white" opacity="0.5"/>
          <rect x="15" y="38" width="20" height="1" fill="white" opacity="0.35"/>
        </svg>`;

      return `
      <div class="product-card" data-brand="${pBrand.replace(/"/g, '&quot;')}">
        <a href="./${p.id}.html" style="text-decoration: none; color: inherit; display: block;">
          <div class="product-card-img">
            <span class="product-badge authentic">✓ Direct Import</span>
            ${imgHTML}
          </div>
          <div class="product-card-body">
            <p class="product-brand">${pBrand}</p>
            <h3 class="product-title-card">${pTitle}</h3>
            <p class="product-desc-card">${pDesc.substring(0, 75)}${pDesc.length > 75 ? '...' : ''}</p>
            <div class="product-footer-card">
              <span class="product-price">৳ ${pPrice}</span>
            </div>
          </div>
        </a>
        <div class="product-card-actions" style="padding: 0 1.5rem 1.5rem;">
          <button class="card-btn-add" onclick="event.preventDefault(); event.stopPropagation(); addToCart('${p.id}', '${pTitle.replace(/'/g, "\\'")}', '${pBrand.replace(/'/g, "\\'")}', '${pPrice}', '${pImage}')">Add To Bag</button>
          <button class="card-btn-buy" onclick="event.preventDefault(); event.stopPropagation(); buyNow('${p.id}', '${pTitle.replace(/'/g, "\\'")}', '${pBrand.replace(/'/g, "\\'")}', '${pPrice}', '${pImage}')">Buy Now</button>
        </div>
      </div>`;
    }).join('\n');

    // Inject cards into the comments placeholder
    const startTag = '<!-- PRERENDER_START -->';
    const endTag = '<!-- PRERENDER_END -->';
    const regex = new RegExp(`${startTag}[\\s\\S]*?${endTag}`, 'g');
    storefrontHtml = storefrontHtml.replace(regex, `${startTag}\n${cardsHtml}\n${endTag}`);

    fs.writeFileSync(storefrontTemplatePath, storefrontHtml, 'utf8');
    console.log("✅ Storefront cards successfully pre-rendered.");
  }

  // --- C. DYNAMIC SITEMAP GENERATION ---
  console.log("🗺️ Creating sitemap.xml...");
  const siteUrl = "https://shuchibd.com"; // Default base, Googlebot indexes relative schema too
  
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/index.html</loc>
    <priority>1.00</priority>
  </url>
  <url>
    <loc>${siteUrl}/storefront.html</loc>
    <priority>0.80</priority>
  </url>`;

  products.forEach(p => {
    sitemap += `
  <url>
    <loc>${siteUrl}/${p.id}.html</loc>
    <priority>0.64</priority>
  </url>`;
  });

  sitemap += `\n</urlset>`;
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap, 'utf8');
  console.log("✅ Sitemap.xml generated successfully.");

  console.log("🎉 Build Complete! Static pages generated successfully.");
}
