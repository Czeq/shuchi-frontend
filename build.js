const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTp7ww3V0vvjNe4qNd-UZTORWpqD6m3bimIXekdzREHjrbBwkV3u5dYxcnoXXz3RjML8BnCfvO8wrg6/pub?gid=0&single=true&output=csv";
const SUPABASE_PROJECT_ID = "okprwbzfsyvrkpygjkum";
const SUPABASE_KEY = "sb_publishable_LAgGxlaltxGIe6wWu1DBkQ_PJN0DLNG";
const HOST = `${SUPABASE_PROJECT_ID}.supabase.co`;
const PATH = "/rest/v1/products?select=*";

console.log("🚀 Starting Jamstack Pre-rendering Build...");

// Helper to parse RFC 4180 CSV with quotes support
function parseCSV(csvText) {
  const lines = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip next escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF
      }
      currentRow.push(currentField.trim());
      if (currentRow.length > 1 || currentRow[0] !== '') {
        lines.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    lines.push(currentRow);
  }

  return lines;
}

// Fetch Google Sheet CSV data (with redirect support)
function fetchGoogleSheetCSV(url = GOOGLE_SHEET_CSV_URL, redirectLimit = 5) {
  return new Promise((resolve, reject) => {
    if (redirectLimit <= 0) {
      return reject(new Error("Too many HTTP redirects when fetching spreadsheet"));
    }

    https.get(url, res => {
      // Follow HTTP redirects (301, 302, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith("http")) {
          redirectUrl = new URL(redirectUrl, url).href;
        }
        return resolve(fetchGoogleSheetCSV(redirectUrl, redirectLimit - 1));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch Google Sheet CSV: HTTP ${res.statusCode}`));
        } else {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

// Convert CSV lines to typed product objects
function parseCSVToProducts(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const colIndex = {
    id: headers.indexOf("id"),
    brand: headers.indexOf("brand"),
    title: headers.indexOf("title"),
    price: headers.indexOf("price"),
    desc: headers.indexOf("desc"),
    skin_type: headers.indexOf("skin_type"),
    volume: headers.indexOf("volume"),
    volume_unit: headers.indexOf("volume_unit"),
    img: headers.indexOf("img")
  };

  if (colIndex.id === -1) {
    throw new Error("Google Sheet CSV is missing the required 'id' header column.");
  }

  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = String(row[colIndex.id]).trim();
    if (!id) continue; // Skip empty/blank rows

    products.push({
      id: id,
      brand: colIndex.brand !== -1 ? String(row[colIndex.brand]).trim() : "",
      title: colIndex.title !== -1 ? String(row[colIndex.title]).trim() : "",
      price: colIndex.price !== -1 ? parseFloat(row[colIndex.price]) || 0 : 0,
      desc: colIndex.desc !== -1 ? String(row[colIndex.desc]).trim() : "",
      skin_type: colIndex.skin_type !== -1 ? String(row[colIndex.skin_type]).trim() : "",
      volume: colIndex.volume !== -1 ? parseFloat(row[colIndex.volume]) || null : null,
      volume_unit: colIndex.volume_unit !== -1 ? String(row[colIndex.volume_unit]).trim() : "",
      img: colIndex.img !== -1 ? String(row[colIndex.img]).trim() : ""
    });
  }
  return products;
}

// Push products to Supabase via Upsert
function syncProductsToSupabase(products) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(products);
    const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

    const options = {
      hostname: HOST,
      path: "/rest/v1/products",
      method: 'POST',
      headers: {
        'apikey': writeKey,
        'Authorization': `Bearer ${writeKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates', // Tell Supabase to perform an upsert on match
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ Database Sync: Successfully upserted ${products.length} products to Supabase.`);
          resolve();
        } else {
          reject(new Error(`Failed to sync spreadsheet with Supabase database (HTTP ${res.statusCode}): ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Query final dataset from Supabase
function fetchAllProductsFromSupabase() {
  return new Promise((resolve, reject) => {
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
            throw new Error(`Failed to fetch database products: HTTP ${res.statusCode}`);
          }
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Orchestrator entry point
async function runSyncAndBuild() {
  try {
    console.log("📥 Step 1: Downloading products spreadsheet from Google Sheets...");
    const csvData = await fetchGoogleSheetCSV();
    
    console.log("⚙️ Step 2: Parsing Google Sheet CSV records...");
    const parsedProducts = parseCSVToProducts(csvData);
    console.log(`Parsed ${parsedProducts.length} product rows.`);
    
    console.log("⚡ Step 3: Syncing records to Supabase tables...");
    await syncProductsToSupabase(parsedProducts);
    
    console.log("🔍 Step 4: Loading final dataset from Supabase...");
    const finalProducts = await fetchAllProductsFromSupabase();
    console.log(`Loaded ${finalProducts.length} final products from database.`);
    
    runGenerator(finalProducts);
  } catch (err) {
    console.error("❌ Build Sync Pipeline failed:", err);
    process.exit(1);
  }
}

runSyncAndBuild();

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

    // Replace Open Graph placeholders
    const cleanDesc = desc.replace(/"/g, '&quot;').replace(/\n/g, ' ').substring(0, 150) + (desc.length > 150 ? '...' : '');
    html = html.replace(/<!-- OG_TITLE -->/g, `${title} — SHUCHI শুচি`);
    html = html.replace(/<!-- OG_DESC -->/g, cleanDesc);
    html = html.replace(/<!-- OG_IMAGE -->/g, image || `https://shuchi-frontend.vercel.app/shuchi_banner.png`);

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
      const pVolume = p.volume ? `${p.volume} ${p.volume_unit || ''}`.trim() : '';

      const imgHTML = pImage ? 
        `<img src="${pImage}" alt="${pTitle}" style="width: 100%; height: 100%; object-fit: contain; padding: 1.5rem; display: block;" onerror="handleImgError(this)">` :
        `<svg width="50" height="76" viewBox="0 0 50 76" fill="none">
          <rect x="11" y="8" width="28" height="62" rx="4" fill="#A8C4A2" opacity="0.5"/>
          <rect x="16" y="3" width="18" height="8" rx="2" fill="#6B8F6B" opacity="0.4"/>
          <rect x="13" y="34" width="24" height="1.5" fill="white" opacity="0.5"/>
          <rect x="15" y="38" width="20" height="1" fill="white" opacity="0.35"/>
        </svg>`;

      const hasVariants = products.filter(item => getBaseProductId(item.id) === baseId).length > 1;
      const variantsBadge = hasVariants ? `<span class="product-badge options-badge">✦ Options Available</span>` : '';

      return `
      <div class="product-card" data-brand="${pBrand.replace(/"/g, '&quot;')}">
        <a href="./${p.id}.html" style="text-decoration: none; color: inherit; display: block;">
          <div class="product-card-img">
            <span class="product-badge authentic">✓ Direct Import</span>
            ${variantsBadge}
            ${imgHTML}
          </div>
          <div class="product-card-body">
            <p class="product-brand">${pBrand}${pVolume ? ` · <span style="color: var(--text-soft); text-transform: none; font-weight: 500; opacity: 0.85;">${pVolume}</span>` : ''}</p>
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
  const siteUrl = "https://shuchi-frontend.vercel.app"; // Default base, Googlebot indexes relative schema too
  
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/index.html</loc>
    <priority>1.00</priority>
  </url>
  <url>
    <loc>${siteUrl}/storefront.html</loc>
    <priority>0.80</priority>
  </url>
  <url>
    <loc>${siteUrl}/influencers.html</loc>
    <priority>0.70</priority>
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
