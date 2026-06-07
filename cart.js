// ── SHUCHI SHOPPING CART & AUTHENTICATION SYSTEM ──

// Supabase Database Connection
const SUPABASE_URL = "https://okprwbzfsyvrkpygjkum.supabase.co";
const SUPABASE_KEY = "sb_publishable_LAgGxlaltxGIe6wWu1DBkQ_PJN0DLNG";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global States
let cartItems = [];
let currentUser = null; // { name, phone, address }
let discountsList = [];
let appliedReferralCode = null;

// Cookie Helper Functions
function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (encodeURIComponent(value) || "") + expires + "; path=/; SameSite=Lax";
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for(let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) == 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
}

// Image loading fallback helpers to prevent HTML attribute parsing quote conflicts
function handleImgError(img) {
  img.outerHTML = `
    <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
      <svg width="50" height="76" viewBox="0 0 50 76" fill="none">
        <rect x="11" y="8" width="28" height="62" rx="4" fill="#A8C4A2" opacity="0.5"/>
        <rect x="16" y="3" width="18" height="8" rx="2" fill="#6B8F6B" opacity="0.4"/>
        <rect x="13" y="34" width="24" height="1.5" fill="white" opacity="0.5"/>
        <rect x="15" y="38" width="20" height="1" fill="white" opacity="0.35"/>
      </svg>
    </div>
  `;
}

function handleDetailImgError(img) {
  img.outerHTML = `
    <svg class="phero-svg" viewBox="0 0 200 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="50" y="40" width="100" height="220" rx="8" fill="#A8C4A2" opacity="0.4"/>
      <rect x="65" y="20" width="70" height="20" rx="4" fill="#6B8F6B" opacity="0.6"/>
      <rect x="60" y="150" width="80" height="2" fill="white" opacity="0.8"/>
      <rect x="70" y="160" width="60" height="1.5" fill="white" opacity="0.5"/>
    </svg>
  `;
}

function handleCartImgError(img) {
  img.outerHTML = `
    <svg width="30" height="46" viewBox="0 0 50 76" fill="none">
      <rect x="11" y="8" width="28" height="62" rx="4" fill="#A8C4A2" opacity="0.5"/>
      <rect x="16" y="3" width="18" height="8" rx="2" fill="#6B8F6B" opacity="0.4"/>
    </svg>
  `;
}

// Helper to parse base product ID from variant suffixes (e.g. brand-product-1 -> brand-product)
function getBaseProductId(id) {
  if (!id) return '';
  return id.replace(/-\d+$/, '');
}

// Fetch products with auto-retry and delay from Supabase
async function fetchProductsWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const { data, error } = await supabaseClient
        .from('products')
        .select('id, brand, title, price, desc, skin_type, volume, volume_unit, img, stock');

      if (error) throw error;

      if (data && data.length > 0) {
        // Normalize Supabase database columns to frontend model keys
        return data.map(item => ({
          id: item.id,
          brand: item.brand,
          title: item.title,
          price: item.price,
          desc: item.desc || '',
          skintype: item.skin_type || '',
          volume: item.volume ? `${item.volume} ${item.volume_unit || ''}`.trim() : '',
          image: item.img || '',
          stock: item.stock === null || item.stock === undefined ? true : item.stock
        }));
      }
      throw new Error("Empty or invalid product list returned from Supabase.");
    } catch (err) {
      console.warn(`Supabase fetch attempt ${i + 1} failed:`, err);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Initialize System
async function initCartSystem() {
  loadCartState();
  loadUserState();
  injectCartUI();
  injectAuthUI();
  injectNavControls();
  
  // Fetch active discounts first
  try {
    await fetchDiscounts();
  } catch(e) {
    console.warn("Failed to load discounts:", e);
  }

  // Auto-apply referral code from query params
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || urlParams.get('promo') || urlParams.get('code');
    if (refCode) {
      const code = refCode.trim().toUpperCase();
      const matched = discountsList.find(d => 
        d.active && 
        (d.id || '').toUpperCase().trim() === code && 
        d.scope === 'referral'
      );
      if (matched) {
        appliedReferralCode = code;
        sessionStorage.setItem('shuchi_ref_code', code);
      }
    } else {
      // Fallback: check if we previously saved it in sessionStorage
      const saved = sessionStorage.getItem('shuchi_ref_code');
      if (saved) {
        const matched = discountsList.find(d => 
          d.active && 
          (d.id || '').toUpperCase().trim() === saved && 
          d.scope === 'referral'
        );
        if (matched) {
          appliedReferralCode = saved;
        } else {
          sessionStorage.removeItem('shuchi_ref_code');
        }
      }
    }
  } catch(e) {
    console.warn("Failed to process URL referral code:", e);
  }
  
  updateCartUI();
  updateAuthUI();
  
  // If product.html, inject the storefront catalog at the bottom
  if (window.location.pathname.includes('product.html')) {
    injectStorefrontCatalogOnDetails();
  }

  // Initialize user registration reminder floating prompt
  initRegistrationPrompt();
  
  // Initialize dynamic discount DOM observer
  initDiscountObserver();
}

// ── DISCOUNT SYSTEM HELPERS & DYNAMIC DOM RENDERER ──

// Fetch active discounts from Supabase database or localStorage fallback
async function fetchDiscounts() {
  try {
    const { data, error } = await supabaseClient
      .from('discounts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    discountsList = data || [];
  } catch (e) {
    console.warn("Discounts table fetch error from database. Falling back to localStorage:", e);
    const local = localStorage.getItem('shuchi_discounts');
    if (local) {
      try {
        discountsList = JSON.parse(local);
      } catch(err) {
        console.error("Failed to parse local discounts:", err);
        discountsList = [];
      }
    } else {
      discountsList = [];
    }
  }
}

// Global category classifier helper
function classifyProductCategory(title, desc) {
  const t = (title || '').toLowerCase();
  const d = (desc || '').toLowerCase();
  
  if (t.includes('shampoo') || t.includes('conditioner') || t.includes('hair wash') || t.includes('hair treatment') || t.includes('scalp')) {
    return 'Shampoo';
  }
  if (t.includes('body wash') || t.includes('shower gel') || t.includes('body cleanser') || t.includes('shower cream')) {
    return 'Body Wash';
  }
  if (t.includes('body cream') || t.includes('body lotion') || t.includes('body milk') || t.includes('body butter') || t.includes('body moisturizer')) {
    return 'Body Cream';
  }
  if (t.includes('sunscreen') || t.includes('sun cream') || t.includes('sunblock') || t.includes('sun gel') || t.includes('sun stick') || t.includes('sun fluid')) {
    return 'Sunscreen';
  }
  if (t.includes('cleansing oil') || t.includes('oil cleanser') || t.includes('cleansing balm') || t.includes('micellar') || t.includes('makeup remover') || t.includes('remover')) {
    return 'Cleanser';
  }
  if (t.includes('facewash') || t.includes('face wash') || t.includes('foam cleanser') || t.includes('cleansing foam') || t.includes('foaming') || t.includes('gel cleanser') || t.includes('gentle cleanser') || t.includes('cleansing gel') || (t.includes('cleanser') && !t.includes('oil') && !t.includes('balm'))) {
    return 'Facewash';
  }
  if (t.includes('toner') || t.includes('tonique') || t.includes('skin refiner') || t.includes('toning')) {
    return 'Toner';
  }
  if (t.includes('essence') || t.includes('mucin') || t.includes('serum') || t.includes('ampoule') || t.includes('treatment essence') || t.includes('booster')) {
    return 'Essence & Serum';
  }
  if (t.includes('lotion') || t.includes('emulsion') || t.includes('moisturizing lotion')) {
    return 'Lotion';
  }
  if (t.includes('cream') || t.includes('gel cream') || t.includes('moisturizer') || t.includes('moisturising') || t.includes('soothing cream') || t.includes('balm') || t.includes('sleeping mask') || t.includes('sleeping pack') || t.includes('water gel')) {
    return 'Cream';
  }
  
  // Fallbacks by analyzing description
  if (d.includes('shampoo') || d.includes('hair')) return 'Shampoo';
  if (d.includes('body wash') || d.includes('shower gel')) return 'Body Wash';
  if (d.includes('body cream') || d.includes('body lotion')) return 'Body Cream';
  if (d.includes('sunscreen') || d.includes('sun cream') || d.includes('sunblock')) return 'Sunscreen';
  if (d.includes('cleansing oil') || d.includes('cleansing balm') || d.includes('makeup remover')) return 'Cleanser';
  if (d.includes('facewash') || d.includes('face wash') || d.includes('cleansing foam') || d.includes('foaming cleanser')) return 'Facewash';
  if (d.includes('toner') || d.includes('toning')) return 'Toner';
  if (d.includes('essence') || d.includes('serum') || d.includes('ampoule')) return 'Essence & Serum';
  if (d.includes('lotion') || d.includes('emulsion')) return 'Lotion';
  if (d.includes('cream') || d.includes('moisturizer') || d.includes('gel cream')) return 'Cream';

  return 'Other';
}

// Calculate discounted price for a product based on active rules
function getDiscountedPrice(product) {
  let fullProduct = product || {};
  const price = parseFloat(fullProduct.price || fullProduct.Price || 0);
  
  const cachedProds = sessionStorage.getItem('shuchi_products');
  if (cachedProds && fullProduct.id) {
    try {
      const products = JSON.parse(cachedProds);
      const found = products.find(p => p.id === fullProduct.id);
      if (found) {
        fullProduct = found;
      }
    } catch(e) {}
  }
  
  const activeDiscounts = discountsList.filter(d => d.active);
  if (activeDiscounts.length === 0) return { price: price, originalPrice: price, discount: null };
  
  let bestPrice = price;
  let bestOriginalPrice = price;
  let appliedDiscount = null;
  
  activeDiscounts.forEach(disc => {
    let matches = false;
    if (disc.scope === 'all') {
      matches = true;
    } else if (disc.scope === 'brand') {
      matches = (fullProduct.brand || fullProduct.Brand || '').toLowerCase().trim() === (disc.scope_value || '').toLowerCase().trim();
    } else if (disc.scope === 'category') {
      const pTitle = fullProduct.title || fullProduct.Title || '';
      const pDesc = fullProduct.desc || fullProduct.Desc || '';
      const pType = classifyProductCategory(pTitle, pDesc);
      matches = pType.toLowerCase().trim() === (disc.scope_value || '').toLowerCase().trim();
    }
    
    if (matches) {
      let currentPrice = price;
      let currentOriginalPrice = price;
      
      const isStrategic = (disc.type && typeof disc.type === 'string' && disc.type.endsWith('_strategic')) || disc.is_reverse || disc.isReverse;
      const baseType = isStrategic ? (disc.type ? disc.type.replace('_strategic', '') : '') : (disc.type || '');
      
      if (isStrategic) {
        currentPrice = price;
        if (baseType === 'percentage') {
          const val = parseFloat(disc.value);
          currentOriginalPrice = val < 100 ? price / (1 - val / 100) : price;
        } else {
          currentOriginalPrice = price + parseFloat(disc.value);
        }
      } else {
        if (baseType === 'percentage') {
          currentPrice = price * (1 - disc.value / 100);
        } else {
          currentPrice = Math.max(0, price - disc.value);
        }
        currentOriginalPrice = price;
      }
      
      if (currentPrice < bestPrice || (currentPrice === bestPrice && currentOriginalPrice > bestOriginalPrice)) {
        bestPrice = currentPrice;
        bestOriginalPrice = currentOriginalPrice;
        appliedDiscount = disc;
      }
    }
  });
  
  return {
    price: bestPrice,
    originalPrice: bestOriginalPrice,
    discount: appliedDiscount,
    discountType: appliedDiscount ? (appliedDiscount.type.includes('percentage') ? 'percentage' : 'flat') : null
  };
}

// Dynamic Discount DOM Applicator
function applyLiveDiscountsToDOM() {
  const cards = document.querySelectorAll('.product-card');
  const cachedProds = sessionStorage.getItem('shuchi_products');
  let products = [];
  if (cachedProds) {
    try {
      products = JSON.parse(cachedProds);
    } catch(e) {}
  }
  
  cards.forEach(card => {
    if (card.dataset.discountApplied === 'true') return;
    
    const link = card.querySelector('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    
    let prodId = null;
    const idMatch = href.match(/\/([^/]+)\.html$/) || href.match(/^([^/]+)\.html$/);
    if (idMatch) {
      prodId = idMatch[1];
    } else {
      const queryMatch = href.match(/[?&]id=([^&]+)/);
      if (queryMatch) {
        prodId = queryMatch[1];
      }
    }
    if (!prodId) return;
    
    const product = products.find(p => p.id === prodId);
    if (!product) return;
    
    const discInfo = getDiscountedPrice(product);
    if (discInfo.discount) {
      const discountedPrice = Math.round(discInfo.price);
      
      // Update Price display
      const priceSpan = card.querySelector('.product-price');
      if (priceSpan) {
        priceSpan.outerHTML = `
          <div class="product-price-container" style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; line-height: 1.2;">
            <span style="text-decoration: line-through; color: var(--text-soft); font-size: 0.78rem; font-weight: normal;">৳ ${Math.round(discInfo.originalPrice).toLocaleString()}</span>
            <span class="product-price" style="color: var(--sage); font-weight: 600;">৳ ${discountedPrice.toLocaleString()}</span>
          </div>
        `;
      }
      
      // Add Badge
      const imgContainer = card.querySelector('.product-card-img');
      if (imgContainer) {
        const discountLabel = discInfo.discountType === 'percentage' 
          ? `${discInfo.discount.value}% Off` 
          : `৳${discInfo.discount.value} Off`;
        
        imgContainer.insertAdjacentHTML('beforeend', `
          <span class="product-badge" style="background: var(--sage); color: var(--white); top: 2.3rem; right: auto; left: 1rem; font-size: 0.65rem; font-weight: 600; padding: 0.15rem 0.45rem; border-radius: 2px; z-index: 5;">
            ${discountLabel}
          </span>
        `);
      }
    }
    card.dataset.discountApplied = 'true';
  });
  
  // 2. Process Product Detail Page Price & Button
  const detailPriceEl = document.getElementById('pricePlaceholder');
  if (detailPriceEl) {
    const hasDiscountBadge = detailPriceEl.querySelector('.product-badge');
    if (!hasDiscountBadge) {
      const urlParams = new URLSearchParams(window.location.search);
      let currId = document.body.dataset.productId || urlParams.get('id') || '';
      if (!currId) {
        const path = window.location.pathname;
        const pathMatch = path.match(/\/([^/]+)\.html$/) || path.match(/\/([^/]+)$/);
        if (pathMatch && pathMatch[1] !== 'product') {
          currId = pathMatch[1];
        }
      }
      if (currId) {
        let product = products.find(p => p.id === currId);
        if (!product) {
          // Fallback: construct product from DOM elements if sessionStorage is empty
          const brandEl = document.getElementById('brandPlaceholder');
          const titleEl = document.getElementById('titlePlaceholder');
          const descEl = document.getElementById('descPlaceholder');
          const priceText = detailPriceEl.textContent || '';
          const numericPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
          if (numericPrice > 0) {
            product = {
              id: currId,
              brand: brandEl ? brandEl.textContent.trim() : '',
              title: titleEl ? titleEl.textContent.trim() : '',
              price: numericPrice,
              desc: descEl ? descEl.textContent.trim() : ''
            };
          }
        }
        if (product) {
          const discInfo = getDiscountedPrice(product);
          if (discInfo.discount) {
            const discountedPrice = Math.round(discInfo.price);
            const discountLabel = discInfo.discountType === 'percentage' 
              ? `${discInfo.discount.value}% Off` 
              : `৳${discInfo.discount.value} Off`;
            
            detailPriceEl.innerHTML = `
              <span style="text-decoration: line-through; font-size: 1.1rem; color: var(--text-soft); font-weight: normal; margin-right: 0.8rem;">৳ ${Math.round(discInfo.originalPrice)}</span>
              ৳ ${discountedPrice}
              <span class="product-badge" style="background: var(--sage); color: var(--white); margin-left: 0.8rem; font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600; vertical-align: middle;">
                ${discountLabel}
              </span>
            `;
            
            // Update Add to Bag button text
            const buyBtn = document.querySelector('.btn-primary');
            if (buyBtn && buyBtn.textContent.includes('Add to Bag')) {
              buyBtn.textContent = `Add to Bag — ৳ ${discountedPrice}`;
            }
          }
        }
      }
    }
  }
}

// Apply Promo / Referral Code entered by user in the cart
function applyPromoCode() {
  const inputEl = document.getElementById('promoCodeInput');
  const feedbackEl = document.getElementById('promoFeedback');
  if (!inputEl || !feedbackEl) return;

  const rawCode = inputEl.value.trim().toUpperCase();
  if (rawCode === "") {
    feedbackEl.style.display = 'block';
    feedbackEl.style.color = '#B8975A';
    feedbackEl.textContent = "Please enter a code.";
    return;
  }

  // Look up referral code in discountsList
  const matched = discountsList.find(d => 
    d.active && 
    (d.id || '').toUpperCase().trim() === rawCode && 
    d.scope === 'referral'
  );

  if (matched) {
    appliedReferralCode = rawCode;
    feedbackEl.style.display = 'block';
    feedbackEl.style.color = 'var(--sage)';
    feedbackEl.textContent = `Referral code "${rawCode}" applied! 10% discount has been activated.`;
    updateCartUI();
  } else {
    appliedReferralCode = null;
    feedbackEl.style.display = 'block';
    feedbackEl.style.color = '#B8975A';
    feedbackEl.textContent = "Invalid promo or referral code.";
    updateCartUI();
  }
}

// Apply Promo / Referral Code entered by user in the checkout overlay
function applyCheckoutPromoCode() {
  const inputEl = document.getElementById('checkoutPromoCode');
  const feedbackEl = document.getElementById('checkoutPromoFeedback');
  if (!inputEl || !feedbackEl) return;

  const rawCode = inputEl.value.trim().toUpperCase();
  if (rawCode === "") {
    feedbackEl.style.display = 'block';
    feedbackEl.style.color = '#B8975A';
    feedbackEl.textContent = "Please enter a code.";
    appliedReferralCode = null;
    updateCartUI();
    return;
  }

  // Look up referral code in discountsList
  const matched = discountsList.find(d => 
    d.active && 
    (d.id || '').toUpperCase().trim() === rawCode && 
    d.scope === 'referral'
  );

  if (matched) {
    appliedReferralCode = rawCode;
    feedbackEl.style.display = 'block';
    feedbackEl.style.color = 'var(--sage)';
    feedbackEl.textContent = `Referral code "${rawCode}" applied! 10% discount activated.`;
    updateCartUI();
  } else {
    appliedReferralCode = null;
    feedbackEl.style.display = 'block';
    feedbackEl.style.color = '#B8975A';
    feedbackEl.textContent = "Invalid promo or referral code.";
    updateCartUI();
  }
}

// Watch for DOM changes to apply discounts on dynamically rendered cards
function initDiscountObserver() {
  applyLiveDiscountsToDOM();
  
  const observer = new MutationObserver((mutations) => {
    let shouldApply = false;
    mutations.forEach(m => {
      if (m.addedNodes.length > 0) {
        shouldApply = true;
      }
    });
    if (shouldApply) {
      applyLiveDiscountsToDOM();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
}

// Load cart from localStorage
function loadCartState() {
  const cached = localStorage.getItem('shuchi_cart');
  if (cached) {
    try {
      cartItems = JSON.parse(cached);
    } catch (e) {
      console.error("Failed to parse cart:", e);
      cartItems = [];
    }
  }
}

// Save cart to localStorage
function saveCartState() {
  localStorage.setItem('shuchi_cart', JSON.stringify(cartItems));
  updateCartUI();
}

// Load user from Cookie
function loadUserState() {
  const userCookie = getCookie('shuchi_user');
  if (userCookie) {
    try {
      currentUser = JSON.parse(userCookie);
    } catch (e) {
      console.error("Failed to parse user cookie:", e);
      currentUser = null;
    }
  }
}

// Save user to Cookie
function saveUserState(user) {
  currentUser = user;
  if (user) {
    setCookie('shuchi_user', JSON.stringify(user), 30); // 30 days
  } else {
    deleteCookie('shuchi_user');
  }
  updateAuthUI();
  
  // Pre-fill checkout form details if open
  prefillCheckoutForm();
}

// Inject Navigation Controls (Account & Bag buttons)
function injectNavControls() {
  const navLinksList = document.querySelectorAll('.nav-links');
  navLinksList.forEach(navLinks => {
    // If controls already exist, skip
    if (navLinks.querySelector('.nav-cart-btn')) return;

    const liAccount = document.createElement('li');
    liAccount.innerHTML = `
      <button class="nav-auth-btn" id="navAuthBtn" onclick="toggleAuthModal(event)">
        <svg class="auth-icon-svg" viewBox="0 0 24 24">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        <span id="navAuthLabel">Sign In</span>
      </button>
    `;

    const liCart = document.createElement('li');
    liCart.innerHTML = `
      <button class="nav-cart-btn" onclick="toggleCartDrawer(event)">
        <svg class="cart-icon-svg" viewBox="0 0 24 24">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        Bag
        <span class="cart-badge" id="cartBadgeCount" style="display: none;">0</span>
      </button>
    `;

    // Insert before navigation CTA (Shop Now) if it exists, or append at the end
    const cta = navLinks.querySelector('.nav-cta');
    if (cta && cta.parentElement) {
      navLinks.insertBefore(liAccount, cta.parentElement);
      navLinks.insertBefore(liCart, cta.parentElement);
    } else {
      navLinks.appendChild(liAccount);
      navLinks.appendChild(liCart);
    }
  });
}

// Inject Cart & Checkout markup
function injectCartUI() {
  if (document.getElementById('cartOverlay')) return;

  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  toastContainer.id = 'toastContainer';
  document.body.appendChild(toastContainer);

  const cartHTML = `
    <div class="cart-overlay" id="cartOverlay" onclick="if(event.target===this)toggleCartDrawer()">
      <div class="cart-drawer">
        <div class="cart-header">
          <h3 class="cart-header-title">Your Bag</h3>
          <button class="cart-close-btn" onclick="toggleCartDrawer()">×</button>
        </div>
        <div class="cart-body" id="cartItemsList"></div>
        <div class="cart-footer">
          
          <div class="cart-summary-line">
            <span>Subtotal</span>
            <span id="cartSubtotal">৳ 0</span>
          </div>
          <div class="cart-summary-line" id="promoDiscountRow" style="display: none; color: var(--sage); font-weight: 500;">
            <span>Referral Discount (10%)</span>
            <span id="promoDiscountValue">-৳ 0</span>
          </div>
          <div class="cart-summary-line">
            <span>Delivery Charge</span>
            <span id="cartDeliveryCharge">৳ 60</span>
          </div>
          <div class="cart-summary-line total">
            <span>Total</span>
            <span id="cartTotal">৳ 0</span>
          </div>
          <button class="cart-checkout-btn" id="cartCheckoutBtn" onclick="openCheckout()">Checkout Now</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', cartHTML);

  const checkoutHTML = `
    <div class="checkout-overlay" id="checkoutOverlay" onclick="if(event.target===this)closeCheckout()">
      <div class="checkout-box">
        <button class="cart-close-btn" style="position:absolute; top:1.2rem; right:1.5rem;" onclick="closeCheckout()">×</button>
        <h3 class="checkout-title">Delivery Details</h3>
        
        <form id="checkoutForm" onsubmit="submitCheckout(event)">
          <div class="form-group">
            <label class="form-label" for="custName">Full Name</label>
            <input type="text" id="custName" class="form-input" required placeholder="e.g. Name">
          </div>
          <div class="form-group">
            <label class="form-label" for="custPhone">Phone Number</label>
            <input type="tel" id="custPhone" class="form-input" required placeholder="e.g. 017XXXXXXXX" pattern="[0-9]{11}" title="Please enter a valid 11-digit Bangladeshi mobile number">
          </div>
          <div class="form-group">
            <label class="form-label" for="custHouse">House / Apartment / Flat No.</label>
            <input type="text" id="custHouse" class="form-input" required placeholder="e.g. Apt 4B, House 23 or Holding 104">
          </div>
          <div class="form-group">
            <label class="form-label" for="custAddress">Street Address & Area</label>
            <input type="text" id="custAddress" class="form-input" required placeholder="e.g. Road 5, Dhanmondi, Dhaka">
          </div>
          <div class="form-group">
            <label class="form-label" for="custArea">Delivery Area</label>
            <select id="custArea" class="form-input" onchange="updateCartUI()" required>
              <option value="inside">Inside Dhaka (৳ 60)</option>
              <option value="outside">Outside Dhaka (৳ 120)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label" for="checkoutPromoCode">Discount / Referral Code (Optional)</label>
            <div style="display: flex; gap: 0.5rem;">
              <input type="text" id="checkoutPromoCode" class="form-input" style="text-transform: uppercase; flex: 1;" placeholder="e.g. SABRINA10">
              <button type="button" onclick="applyCheckoutPromoCode()" class="btn-primary" style="padding: 0.5rem 1.2rem; font-size: 0.72rem; letter-spacing: 0.05em; height: auto;">Apply</button>
            </div>
            <div id="checkoutPromoFeedback" style="font-size: 0.72rem; margin-top: 0.25rem; display: none; font-weight: 500; text-align: left;"></div>
          </div>

          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <div class="payment-options">
              <div class="pay-opt-card selected" id="optCod" onclick="selectPaymentOpt('cod')">
                <input type="radio" name="payOpt" id="payCod" value="COD" checked>
                <span class="pay-opt-label">Cash on Delivery</span>
              </div>
              <div class="pay-opt-card" id="optBkash" onclick="selectPaymentOpt('bkash')">
                <input type="radio" name="payOpt" id="payBkash" value="bKash">
                <span class="pay-opt-label">bKash</span>
              </div>
            </div>
          </div>

          <div class="checkout-summary-box" style="background: var(--cream); padding: 1.2rem; border-radius: 6px; margin: 1.5rem 0; border: 1px solid var(--cream-deep);">
            <h4 style="font-family: Georgia, serif; font-size: 1rem; color: var(--dark); margin-top: 0; margin-bottom: 0.8rem; font-weight: 500; text-align: left;">Order Summary</h4>
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 0.4rem; color: var(--text-soft);">
              <span>Items Subtotal</span>
              <span id="checkoutSubtotal">৳ 0</span>
            </div>
            <div id="checkoutDiscountRow" style="display: none; justify-content: space-between; font-size: 0.82rem; margin-bottom: 0.4rem; color: var(--sage); font-weight: 500;">
              <span>Referral Discount (10%)</span>
              <span id="checkoutDiscountValue">-৳ 0</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 0.4rem; color: var(--text-soft);">
              <span>Delivery Charge</span>
              <span id="checkoutDelivery">৳ 0</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.92rem; font-weight: bold; border-top: 1px dashed rgba(107,143,107,0.2); padding-top: 0.6rem; margin-top: 0.6rem; color: var(--dark);">
              <span>Total to Pay</span>
              <span id="checkoutTotal">৳ 0</span>
            </div>
          </div>

          <div class="checkout-actions">
            <button type="button" class="checkout-cancel-btn" onclick="closeCheckout()">Go Back</button>
            <button type="submit" class="checkout-submit-btn">Place Order</button>
          </div>
        </form>

        <div class="checkout-status-screen" id="checkoutStatusScreen">
          <div class="status-flower-container">
            <svg class="logo-loader" id="statusSpinner" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 64px; height: 64px; margin: 0 auto;">
              <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
              <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
              <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
              <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
              <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
            </svg>
            <div class="success-icon" id="successIcon" style="display:none; margin-bottom: 0;">✓</div>
          </div>
          <h4 class="status-title" id="statusTitle">Processing Order...</h4>

          <div class="processing-bar-layers" id="processingBarLayers">
            <div class="layer-step" id="layerStep1">
              <div class="layer-meta">
                <span class="layer-name-container">
                  <svg class="step-flower-icon" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
                    <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
                    <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
                    <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
                    <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
                  </svg>
                  <span class="layer-name">Bag Validation</span>
                </span>
                <span class="layer-pct" id="layerPct1">0%</span>
              </div>
              <div class="layer-bar-bg">
                <div class="layer-bar-fill" id="layerFill1"></div>
              </div>
            </div>

            <div class="layer-step" id="layerStep2">
              <div class="layer-meta">
                <span class="layer-name-container">
                  <svg class="step-flower-icon" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
                    <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
                    <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
                    <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
                    <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
                  </svg>
                  <span class="layer-name">Security Verification</span>
                </span>
                <span class="layer-pct" id="layerPct2">0%</span>
              </div>
              <div class="layer-bar-bg">
                <div class="layer-bar-fill" id="layerFill2"></div>
              </div>
            </div>

            <div class="layer-step" id="layerStep3">
              <div class="layer-meta">
                <span class="layer-name-container">
                  <svg class="step-flower-icon" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
                    <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
                    <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
                    <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
                    <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
                  </svg>
                  <span class="layer-name">Database Registry</span>
                </span>
                <span class="layer-pct" id="layerPct3">0%</span>
              </div>
              <div class="layer-bar-bg">
                <div class="layer-bar-fill" id="layerFill3"></div>
              </div>
            </div>

            <div class="layer-step" id="layerStep4">
              <div class="layer-meta">
                <span class="layer-name-container">
                  <svg class="step-flower-icon" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
                    <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
                    <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
                    <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
                    <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
                  </svg>
                  <span class="layer-name">Finalizing Order</span>
                </span>
                <span class="layer-pct" id="layerPct4">0%</span>
              </div>
              <div class="layer-bar-bg">
                <div class="layer-bar-fill" id="layerFill4"></div>
              </div>
            </div>
          </div>

          <p class="status-desc" id="statusDesc">Writing order records securely to the Shuchi User database.</p>
          <button class="cart-checkout-btn" id="statusActionBtn" style="display:none; margin-top:1.5rem;" onclick="closeCheckoutAfterSuccess()">Continue Shopping</button>
        </div>

      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', checkoutHTML);
}

// Inject User Account Authentication Modal HTML
function injectAuthUI() {
  if (document.getElementById('authOverlay')) return;

  const authHTML = `
    <div class="auth-overlay" id="authOverlay" onclick="if(event.target===this)toggleAuthModal()">
      <div class="auth-box">
        <button class="cart-close-btn" style="position:absolute; top:1.2rem; right:1.5rem;" onclick="toggleAuthModal()">×</button>
        
        <!-- Auth state panel: Unauthenticated (Login/Register Forms) -->
        <div id="authUnauthenticatedPanel">
          <div class="auth-tabs">
            <button class="auth-tab active" id="tabSignIn" onclick="switchAuthTab('signin')">Sign In</button>
            <button class="auth-tab" id="tabSignUp" onclick="switchAuthTab('signup')">Sign Up</button>
          </div>
          
          <div id="authErrorMessage" style="color: #e53e3e; background: #fff5f5; border: 1px solid #fed7d7; padding: 0.8rem; margin: 1rem 0 0.2rem 0; font-size: 0.82rem; border-radius: 4px; display: none; text-align: left; font-weight: 500; line-height: 1.4;"></div>

          <!-- Sign In Form -->
          <form id="signInForm" class="auth-panel active" onsubmit="submitSignIn(event)">
            <div class="form-group">
              <label class="form-label" for="signInPhone">Phone Number</label>
              <input type="tel" id="signInPhone" class="form-input" required placeholder="017XXXXXXXX" pattern="[0-9]{11}">
            </div>
            <div class="auth-actions">
              <button type="button" class="checkout-cancel-btn" onclick="toggleAuthModal()">Cancel</button>
              <button type="submit" class="auth-submit-btn">Sign In</button>
            </div>
          </form>

          <!-- Sign Up Form -->
          <form id="signUpForm" class="auth-panel" onsubmit="submitSignUp(event)">
            <div class="form-group">
              <label class="form-label" for="signUpName">Full Name</label>
              <input type="text" id="signUpName" class="form-input" required placeholder="Name">
            </div>
            <div class="form-group">
              <label class="form-label" for="signUpPhone">Phone Number</label>
              <input type="tel" id="signUpPhone" class="form-input" required placeholder="017XXXXXXXX" pattern="[0-9]{11}">
            </div>
             <div class="form-group">
              <label class="form-label" for="signUpHouse">House / Apartment / Flat No.</label>
              <input type="text" id="signUpHouse" class="form-input" required placeholder="e.g. Apt 4B, House 23 or Holding 104">
            </div>
            <div class="form-group">
              <label class="form-label" for="signUpAddress">Street Address & Area</label>
              <input type="text" id="signUpAddress" class="form-input" required placeholder="e.g. Road 5, Dhanmondi, Dhaka">
            </div>
            <div class="auth-actions">
              <button type="button" class="checkout-cancel-btn" onclick="toggleAuthModal()">Cancel</button>
              <button type="submit" class="auth-submit-btn">Create Account</button>
            </div>
          </form>
        </div>

        <!-- Auth state panel: Authenticated (Account Profiles Screen) -->
        <div id="authAuthenticatedPanel" style="display: none;">
          <!-- Profile View Mode -->
          <div id="authProfileViewPanel">
            <div class="user-account-info">
              <div class="user-avatar-large" id="userAvatarPlaceholder">U</div>
              <h3 class="user-name-title" id="userNameTitle">Customer Name</h3>
              <p class="user-phone-sub" id="userPhoneSub">017XXXXXXXX</p>
              
              <div class="user-details-card">
                <div class="ud-label">Default Address</div>
                <div class="ud-value" id="userAddressVal">Delivery Address here</div>
              </div>

              <!-- Edit & Sign Out Actions -->
              <div class="auth-actions" style="margin-top: 1.2rem; display: flex; gap: 0.8rem;">
                <button class="cart-checkout-btn" style="flex: 1; margin: 0; padding: 0.6rem 1rem;" onclick="enableProfileEdit()">Edit Details</button>
                <button class="checkout-cancel-btn" style="flex: 1; margin: 0; padding: 0.6rem 1rem;" onclick="signOutUser()">Sign Out</button>
              </div>

              <!-- Purchase History -->
              <div class="purchase-history-section">
                <h4 class="history-title">Purchase History</h4>
                <div id="purchaseHistoryList" class="purchase-history-list">
                  <p class="history-empty">Loading history...</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Profile Edit Mode -->
          <div id="authProfileEditPanel" style="display: none;">
            <h3 class="checkout-title" style="margin-top: 0; margin-bottom: 1.5rem; text-align: center;">Edit Account Details</h3>
            <form id="profileEditForm" onsubmit="saveProfileEdit(event)">
              <div class="form-group">
                <label class="form-label" for="editName">Full Name</label>
                <input type="text" id="editName" class="form-input" required placeholder="e.g. Name">
              </div>
              <div class="form-group">
                <label class="form-label" for="editHouse">House / Apartment / Flat No.</label>
                <input type="text" id="editHouse" class="form-input" required placeholder="e.g. Apt 4B, House 23 or Holding 104">
              </div>
              <div class="form-group">
                <label class="form-label" for="editAddress">Street Address & Area</label>
                <input type="text" id="editAddress" class="form-input" required placeholder="e.g. Road 5, Dhanmondi, Dhaka">
              </div>
              
              <div id="editProfileStatus" class="status-desc" style="display: none; text-align: center; color: var(--sage); margin-bottom: 1rem;">Saving changes...</div>

              <div class="auth-actions" style="margin-top: 1.5rem; display: flex; gap: 0.8rem;">
                <button type="button" class="checkout-cancel-btn" style="flex: 1; margin: 0;" onclick="disableProfileEdit()">Cancel</button>
                <button type="submit" class="auth-submit-btn" style="flex: 1; margin: 0;">Save Changes</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Submission Status Overlays inside Auth box -->
        <div class="checkout-status-screen" id="authStatusScreen">
          <svg class="logo-loader" id="authSpinner" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 64px; height: 64px; margin: 0 auto 1.5rem;">
            <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
            <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
            <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
            <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
            <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
          </svg>
          <h4 class="status-title" id="authStatusTitle">Contacting Server...</h4>
          <p class="status-desc" id="authStatusDesc">We are connecting to the Shuchi User data base.</p>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', authHTML);
}

// Toggle drawer opening
function toggleCartDrawer(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const overlay = document.getElementById('cartOverlay');
  if (overlay) {
    overlay.classList.toggle('active');
    
    // Close other panels
    const mainNav = document.getElementById('mainNav');
    if (mainNav) mainNav.classList.remove('mopen');
    closeCheckout();
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.classList.remove('active');
  }
}

// Toggle Account modal
function toggleAuthModal(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.classList.toggle('active');
    
    // Reset forms when opening
    document.getElementById('signInForm').reset();
    document.getElementById('signUpForm').reset();
    switchAuthTab('signin');
    
    // Close other panels
    const mainNav = document.getElementById('mainNav');
    if (mainNav) mainNav.classList.remove('mopen');
    const cartOverlay = document.getElementById('cartOverlay');
    if (cartOverlay) cartOverlay.classList.remove('active');
    closeCheckout();
  }
}

// Trigger order tracking via the auth overlay
function triggerOrderTracking() {
  injectAuthUI(); // Ensure auth UI elements are in the DOM
  
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;

  // Open the modal
  overlay.classList.add('active');

  // Close other overlays
  const mainNav = document.getElementById('mainNav');
  if (mainNav) mainNav.classList.remove('mopen');
  const cartOverlay = document.getElementById('cartOverlay');
  if (cartOverlay) cartOverlay.classList.remove('active');
  closeCheckout();

  if (currentUser) {
    // Already logged in: show authenticated dashboard & purchase history
    updateAuthUI();
    
    // Smooth scroll to the purchase history
    setTimeout(() => {
      const historyList = document.getElementById('purchaseHistoryList');
      if (historyList) {
        historyList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  } else {
    // Guest: prompt to login
    switchAuthTab('signin');
    showToast("Please sign in to track your order history.");
  }
}
window.triggerOrderTracking = triggerOrderTracking;


// Switch registration/login tabs in Modal
function switchAuthTab(tab) {
  const tabIn = document.getElementById('tabSignIn');
  const tabUp = document.getElementById('tabSignUp');
  const formIn = document.getElementById('signInForm');
  const formUp = document.getElementById('signUpForm');

  const errMsg = document.getElementById('authErrorMessage');
  if (errMsg) {
    errMsg.style.display = 'none';
    errMsg.textContent = '';
  }

  if (tab === 'signin') {
    tabIn.classList.add('active');
    tabUp.classList.remove('active');
    formIn.classList.add('active');
    formUp.classList.remove('active');
  } else {
    tabIn.classList.remove('active');
    tabUp.classList.add('active');
    formIn.classList.remove('active');
    formUp.classList.add('active');
  }
}

// Show auth loading overlay inside the modal
function toggleAuthLoader(show, title = "Please Wait...", desc = "") {
  const screen = document.getElementById('authStatusScreen');
  if (!screen) return;
  
  if (show) {
    document.getElementById('authStatusTitle').textContent = title;
    document.getElementById('authStatusDesc').textContent = desc;
    screen.classList.add('active');
  } else {
    screen.classList.remove('active');
  }
}

// Handle Sign Up (Registers User to Supabase + Sets Cookie)
async function submitSignUp(e) {
  e.preventDefault();

  const name = document.getElementById('signUpName').value.trim();
  const phone = document.getElementById('signUpPhone').value.trim();
  const house = document.getElementById('signUpHouse').value.trim();
  const street = document.getElementById('signUpAddress').value.trim();
  const address = `${house}, ${street}`;

  const errMsg = document.getElementById('authErrorMessage');
  if (errMsg) {
    errMsg.style.display = 'none';
    errMsg.textContent = '';
  }

  toggleAuthLoader(true, "Registering Account...", "We are connecting to the Shuchi User data base.");

  try {
    // 1. Check if user already exists
    const { data: existingUser, error: checkError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingUser) {
      throw new Error("Phone number already registered. Please Sign In!");
    }

    // 2. Register user profile
    const { error: insertError } = await supabaseClient
      .from('profiles')
      .insert([{ 
        name, 
        phone, 
        address,
        created_at: new Date().toISOString()
      }]);

    if (insertError) throw insertError;

    saveUserState({ name, phone, address });
    toggleAuthLoader(false);
    toggleAuthModal();
    showToast(`Account created! Welcome to SHUCHI, ${name}.`);
  } catch (err) {
    console.error("Supabase registration failed:", err);
    toggleAuthLoader(false);
    if (errMsg) {
      errMsg.textContent = `Registration failed: ${err.message || err.toString()}`;
      errMsg.style.display = 'block';
    }
  }
}

// Handle Sign In (Looks up Phone number in Supabase, logs user in via Cookie)
async function submitSignIn(e) {
  e.preventDefault();

  const phone = document.getElementById('signInPhone').value.trim();

  const errMsg = document.getElementById('authErrorMessage');
  if (errMsg) {
    errMsg.style.display = 'none';
    errMsg.textContent = '';
  }

  toggleAuthLoader(true, "Signing In...", "We are connecting to the Shuchi User data base.");

  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      saveUserState({
        name: data.name,
        phone: data.phone,
        address: data.address
      });
      toggleAuthLoader(false);
      toggleAuthModal();
      showToast(`Welcome back, ${data.name}!`);
    } else {
      throw new Error("Phone number not registered. Please Sign Up!");
    }
  } catch (err) {
    console.error("Sign in failed:", err);
    toggleAuthLoader(false);
    if (errMsg) {
      errMsg.textContent = `Could not sign in: ${err.message || err.toString()}`;
      errMsg.style.display = 'block';
    }
  }
}

// Sign Out Account
function signOutUser() {
  const name = currentUser ? currentUser.name : '';
  saveUserState(null);
  toggleAuthModal();
  showToast(`Signed out successfully. Goodbye, ${name}!`);
}

// Update the Login/Register state in the UI
function updateAuthUI() {
  const labels = document.querySelectorAll('#navAuthLabel');
  const icons = document.querySelectorAll('.auth-icon-svg');
  
  const authUnauthenticated = document.getElementById('authUnauthenticatedPanel');
  const authAuthenticated = document.getElementById('authAuthenticatedPanel');

  const nameTitle = document.getElementById('userNameTitle');
  const phoneSub = document.getElementById('userPhoneSub');
  const addressVal = document.getElementById('userAddressVal');
  const avatarVal = document.getElementById('userAvatarPlaceholder');

  // Reset panels back to Profile View mode
  const viewPanel = document.getElementById('authProfileViewPanel');
  const editPanel = document.getElementById('authProfileEditPanel');
  if (viewPanel) viewPanel.style.display = 'block';
  if (editPanel) editPanel.style.display = 'none';

  if (currentUser) {
    // Authenticated State
    labels.forEach(label => label.textContent = currentUser.name.split(' ')[0]);
    icons.forEach(icon => icon.style.stroke = 'var(--sage)');
    
    if (authUnauthenticated) authUnauthenticated.style.display = 'none';
    if (authAuthenticated) authAuthenticated.style.display = 'block';

    if (nameTitle) nameTitle.textContent = currentUser.name;
    if (phoneSub) phoneSub.textContent = currentUser.phone;
    if (addressVal) addressVal.textContent = currentUser.address;
    if (avatarVal) avatarVal.textContent = currentUser.name.charAt(0).toUpperCase();

    // Fetch and load order history
    fetchPurchaseHistory(currentUser.phone);
  } else {
    // Unauthenticated State
    labels.forEach(label => label.textContent = "Sign In");
    icons.forEach(icon => icon.style.stroke = 'currentColor');

    if (authUnauthenticated) authUnauthenticated.style.display = 'block';
    if (authAuthenticated) authAuthenticated.style.display = 'none';
  }
}

// Enable Profile Edit Panel and load existing details
function enableProfileEdit() {
  const viewPanel = document.getElementById('authProfileViewPanel');
  const editPanel = document.getElementById('authProfileEditPanel');
  
  if (currentUser) {
    document.getElementById('editName').value = currentUser.name || '';
    
    let houseVal = '';
    let addressVal = currentUser.address || '';
    if (currentUser.address && currentUser.address.includes(',')) {
      const idx = currentUser.address.indexOf(',');
      houseVal = currentUser.address.substring(0, idx).trim();
      addressVal = currentUser.address.substring(idx + 1).trim();
    }
    document.getElementById('editHouse').value = houseVal;
    document.getElementById('editAddress').value = addressVal;
  }

  if (viewPanel) viewPanel.style.display = 'none';
  if (editPanel) editPanel.style.display = 'block';
}

// Disable Profile Edit Panel
function disableProfileEdit() {
  const viewPanel = document.getElementById('authProfileViewPanel');
  const editPanel = document.getElementById('authProfileEditPanel');
  if (viewPanel) viewPanel.style.display = 'block';
  if (editPanel) editPanel.style.display = 'none';
}

// Save Profile Updates to Supabase
async function saveProfileEdit(e) {
  e.preventDefault();
  
  if (!currentUser) return;
  
  const statusEl = document.getElementById('editProfileStatus');
  const name = document.getElementById('editName').value.trim();
  const house = document.getElementById('editHouse').value.trim();
  const street = document.getElementById('editAddress').value.trim();
  const address = `${house}, ${street}`;

  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--sage)';
    statusEl.textContent = "Saving changes to the Shuchi User database...";
  }

  let success = false;
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .update({ name, address })
      .eq('phone', currentUser.phone)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error("No database records were modified. You may not have permission to update this profile.");
    }

    currentUser.name = name;
    currentUser.address = address;
    saveUserState(currentUser);
    updateAuthUI();
    disableProfileEdit();
    showToast("Profile details updated successfully!");
    success = true;
  } catch (err) {
    console.error("Profile edit failed:", err);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#e53e3e';
      statusEl.textContent = `Failed to update details: ${err.message || err.toString()}`;
    }
  } finally {
    if (success && statusEl) {
      statusEl.style.display = 'none';
    }
  }
}

// Fetch and render purchase history dynamically from Supabase
async function fetchPurchaseHistory(phone) {
  const container = document.getElementById('purchaseHistoryList');
  if (!container) return;

  try {
    const { data: orders, error } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!orders || orders.length === 0) {
      container.innerHTML = '<p class="history-empty">No purchases found yet.</p>';
      return;
    }

    container.innerHTML = orders.map(order => {
      const dateStr = new Date(order.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      
      const statusClass = (order.status || 'processing').toLowerCase();
      const formattedStatus = order.status || 'Processing';

      let trackingHTML = '';
      if (statusClass === 'cancelled') {
        trackingHTML = `
          <div class="order-tracking-bar">
            <div class="track-line failed" style="width: 100%;"></div>
            <div class="track-steps">
              <div class="track-step failed" style="width: 100%;">
                <span class="track-dot"></span>
                <span class="track-label">Order Cancelled</span>
              </div>
            </div>
          </div>
        `;
      } else {
        let fillWidth = 0;
        let step1 = 'completed'; // Placed
        let step2 = ''; // Processing
        let step3 = ''; // Sent to Supplier
        let step4 = ''; // Delivered

        if (statusClass === 'processing' || statusClass === 'placed') {
          fillWidth = 33;
          step2 = 'active';
        } else if (statusClass === 'sent to supplier' || statusClass === 'sent-to-supplier') {
          fillWidth = 66;
          step2 = 'completed';
          step3 = 'active';
        } else if (statusClass === 'delivered') {
          fillWidth = 100;
          step2 = 'completed';
          step3 = 'completed';
          step4 = 'completed';
        }

        trackingHTML = `
          <div class="order-tracking-bar">
            <div class="track-line">
              <div class="track-line-fill" style="width: ${fillWidth}%;"></div>
            </div>
            <div class="track-steps">
              <div class="track-step ${step1}">
                <span class="track-dot"></span>
                <span class="track-label">Placed</span>
              </div>
              <div class="track-step ${step2}">
                <span class="track-dot"></span>
                <span class="track-label">Processing</span>
              </div>
              <div class="track-step ${step3}">
                <span class="track-dot"></span>
                <span class="track-label">Sent to Supplier</span>
              </div>
              <div class="track-step ${step4}">
                <span class="track-dot"></span>
                <span class="track-label">Delivered</span>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="order-history-card">
          <div class="order-hist-header" style="align-items: flex-start;">
            <span class="order-hist-items-prominent">${order.items}</span>
            <span class="order-hist-status ${statusClass}">${formattedStatus}</span>
          </div>
          <div class="order-hist-meta-row">
            <span class="order-hist-id-secondary">Order ${order.order_id}</span>
            <span class="order-hist-date-secondary">${dateStr}</span>
          </div>
          ${trackingHTML}
          <div class="order-hist-footer-price">
            <span>Total Price</span>
            <span class="order-hist-price">৳ ${parseInt(order.total_price || 0).toLocaleString()}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error("Failed to load order history:", err);
    container.innerHTML = '<p class="history-empty" style="color: #B22222;">Failed to load purchase history.</p>';
  }
}

// Pre-fill delivery details if user has logged in
function prefillCheckoutForm() {
  const nameInput = document.getElementById('custName');
  const phoneInput = document.getElementById('custPhone');
  const houseInput = document.getElementById('custHouse');
  const addressInput = document.getElementById('custAddress');

  if (currentUser) {
    if (nameInput) nameInput.value = currentUser.name;
    if (phoneInput) phoneInput.value = currentUser.phone;
    
    let houseVal = '';
    let addressVal = currentUser.address || '';
    if (currentUser.address && currentUser.address.includes(',')) {
      const idx = currentUser.address.indexOf(',');
      houseVal = currentUser.address.substring(0, idx).trim();
      addressVal = currentUser.address.substring(idx + 1).trim();
    }
    if (houseInput) houseInput.value = houseVal;
    if (addressInput) addressInput.value = addressVal;
  } else {
    if (nameInput) nameInput.value = "";
    if (phoneInput) phoneInput.value = "";
    if (houseInput) houseInput.value = "";
    if (addressInput) addressInput.value = "";
  }
}

// Cart System Logic
function addToCart(id, title, brand, price, image) {
  let numericPrice = 0;
  if (typeof price === 'number') {
    numericPrice = price;
  } else if (typeof price === 'string') {
    numericPrice = parseInt(price.replace(/[^0-9]/g, ''), 10) || 0;
  }

  const existing = cartItems.find(item => item.id === id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cartItems.push({
      id: id,
      title: title,
      brand: brand,
      price: numericPrice,
      image: image || '',
      quantity: 1
    });
  }

  saveCartState();
  showToast(`Added "${title}" to your Bag!`);
}

// Buy Now Function: adds item and triggers instant checkout modal
function buyNow(id, title, brand, price, image) {
  // Clear any existing cart items to make it a direct purchase of THIS item
  cartItems = [];
  addToCart(id, title, brand, price, image);
  openCheckout();
}

function updateQuantity(id, change) {
  const item = cartItems.find(item => item.id === id);
  if (!item) return;

  item.quantity += change;
  if (item.quantity <= 0) {
    removeFromCart(id);
  } else {
    saveCartState();
  }
}

function removeFromCart(id) {
  cartItems = cartItems.filter(item => item.id !== id);
  saveCartState();
}

function selectPaymentOpt(method) {
  document.getElementById('optCod').classList.remove('selected');
  document.getElementById('optBkash').classList.remove('selected');
  document.getElementById('payCod').checked = false;
  document.getElementById('payBkash').checked = false;

  if (method === 'cod') {
    document.getElementById('optCod').classList.add('selected');
    document.getElementById('payCod').checked = true;
  } else {
    document.getElementById('optBkash').classList.add('selected');
    document.getElementById('payBkash').checked = true;
  }
}

function updateCartUI() {
  const badgeCounts = document.querySelectorAll('#cartBadgeCount');
  const itemsContainer = document.getElementById('cartItemsList');
  const subtotalEl = document.getElementById('cartSubtotal');
  const deliveryEl = document.getElementById('cartDeliveryCharge');
  const totalEl = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');

  if (!itemsContainer) return;

  const totalQuantity = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  badgeCounts.forEach(badge => {
    badge.textContent = totalQuantity;
    badge.style.display = totalQuantity > 0 ? 'flex' : 'none';
  });

  const subtotal = cartItems.reduce((acc, item) => {
    const discountInfo = getDiscountedPrice(item);
    return acc + (Math.round(discountInfo.price) * item.quantity);
  }, 0);
  
  let referralDiscount = 0;
  const promoDiscountRow = document.getElementById('promoDiscountRow');
  const promoDiscountValue = document.getElementById('promoDiscountValue');
  
  if (appliedReferralCode && subtotal > 0) {
    referralDiscount = Math.round(subtotal * 0.1);
    if (promoDiscountRow && promoDiscountValue) {
      promoDiscountRow.style.display = 'flex';
      promoDiscountValue.textContent = `-৳ ${referralDiscount.toLocaleString()}`;
    }
  } else {
    if (promoDiscountRow) promoDiscountRow.style.display = 'none';
  }
  
  const areaSelect = document.getElementById('custArea');
  const areaValue = areaSelect ? areaSelect.value : 'inside';
  const deliveryCharge = totalQuantity === 0 ? 0 : (areaValue === 'inside' ? 60 : 120);
  const total = Math.max(0, subtotal - referralDiscount + deliveryCharge);

  subtotalEl.textContent = `৳ ${subtotal.toLocaleString()}`;
  deliveryEl.textContent = `৳ ${deliveryCharge.toLocaleString()}`;
  totalEl.textContent = `৳ ${total.toLocaleString()}`;

  // Update checkout modal summary fields if present
  const checkSubtotalEl = document.getElementById('checkoutSubtotal');
  const checkDiscountRow = document.getElementById('checkoutDiscountRow');
  const checkDiscountVal = document.getElementById('checkoutDiscountValue');
  const checkDeliveryEl = document.getElementById('checkoutDelivery');
  const checkTotalEl = document.getElementById('checkoutTotal');

  if (checkSubtotalEl) checkSubtotalEl.textContent = `৳ ${subtotal.toLocaleString()}`;
  if (checkDeliveryEl) checkDeliveryEl.textContent = `৳ ${deliveryCharge.toLocaleString()}`;
  if (checkTotalEl) checkTotalEl.textContent = `৳ ${total.toLocaleString()}`;
  if (checkDiscountRow && checkDiscountVal) {
    if (referralDiscount > 0) {
      checkDiscountRow.style.display = 'flex';
      checkDiscountVal.textContent = `-৳ ${referralDiscount.toLocaleString()}`;
    } else {
      checkDiscountRow.style.display = 'none';
    }
  }

  if (checkoutBtn) {
    checkoutBtn.disabled = totalQuantity === 0;
    checkoutBtn.style.opacity = totalQuantity === 0 ? '0.4' : '1';
    checkoutBtn.style.pointerEvents = totalQuantity === 0 ? 'none' : 'auto';
  }

  if (cartItems.length === 0) {
    itemsContainer.innerHTML = `
      <div class="cart-empty-message">
        <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.2" viewBox="0 0 24 24">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <p>Your bag is currently empty.</p>
        <button class="wiki-btn" style="pointer-events:auto;" onclick="toggleCartDrawer()">Discover Products</button>
      </div>
    `;
    return;
  }

  itemsContainer.innerHTML = cartItems.map(item => {
    const imgHTML = item.image ? 
      `<img src="${item.image}" alt="${item.title}" onerror="handleCartImgError(this)">` :
      `<svg width="30" height="46" viewBox="0 0 50 76" fill="none">
        <rect x="11" y="8" width="28" height="62" rx="4" fill="#A8C4A2" opacity="0.5"/>
        <rect x="16" y="3" width="18" height="8" rx="2" fill="#6B8F6B" opacity="0.4"/>
      </svg>`;

    const discountInfo = getDiscountedPrice(item);
    const discountedPrice = Math.round(discountInfo.price);
    const originalPrice = Math.round(discountInfo.originalPrice);
    const hasDiscount = originalPrice > discountedPrice;
    const priceHTML = hasDiscount 
      ? `<div style="display:flex; flex-direction:column; gap:0.1rem; align-items:flex-start;">
           <div style="display:flex; align-items:center; gap:0.5rem; line-height:1.2;">
             <span style="text-decoration:line-through; color:var(--text-soft); font-weight:normal; font-size:0.8rem;">৳ ${originalPrice.toLocaleString()}</span>
             <span style="color:var(--sage); font-weight:600; font-size:0.95rem;">৳ ${discountedPrice.toLocaleString()}</span>
           </div>
           <span style="background:var(--sage-pale); color:var(--dark-mid); font-size:0.65rem; font-weight:600; padding:0.1rem 0.35rem; border-radius:2px; display:inline-block; margin-top:0.15rem; line-height:1;">
             ${discountInfo.discountType === 'percentage' ? `${discountInfo.discount.value}% Off` : `৳${discountInfo.discount.value} Off`}
           </span>
         </div>`
      : `৳ ${item.price.toLocaleString()}`;

    return `
      <div class="cart-item">
        <div class="cart-item-img">${imgHTML}</div>
        <div class="cart-item-details">
          <span class="cart-item-brand">${item.brand}</span>
          <h4 class="cart-item-title">${item.title}</h4>
          <div class="cart-item-price">${priceHTML}</div>
          <div class="cart-item-actions">
            <div class="qty-control">
              <button class="qty-btn" onclick="updateQuantity('${item.id}', -1)">-</button>
              <span class="qty-val">${item.quantity}</span>
              <button class="qty-btn" onclick="updateQuantity('${item.id}', 1)">+</button>
            </div>
            <button class="cart-item-remove" onclick="removeFromCart('${item.id}')">Remove</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-success-dot"></span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 50);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

function openCheckout() {
  const cartOverlay = document.getElementById('cartOverlay');
  if (cartOverlay) cartOverlay.classList.remove('active');

  const checkoutOverlay = document.getElementById('checkoutOverlay');
  if (checkoutOverlay) {
    prefillCheckoutForm(); // fill user profile if logged in
    
    // Sync promo code input
    const checkoutPromoEl = document.getElementById('checkoutPromoCode');
    const checkoutPromoFeedbackEl = document.getElementById('checkoutPromoFeedback');
    if (checkoutPromoEl) {
      checkoutPromoEl.value = appliedReferralCode || '';
      if (checkoutPromoFeedbackEl) {
        if (appliedReferralCode) {
          checkoutPromoFeedbackEl.style.display = 'block';
          checkoutPromoFeedbackEl.style.color = 'var(--sage)';
          checkoutPromoFeedbackEl.textContent = `Promo code "${appliedReferralCode}" applied!`;
        } else {
          checkoutPromoFeedbackEl.style.display = 'none';
        }
      }
    }
    
    checkoutOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    updateCartUI(); // trigger summary updates in checkout box
  }
}

function closeCheckout() {
  const checkoutOverlay = document.getElementById('checkoutOverlay');
  if (checkoutOverlay) {
    checkoutOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Helper to animate progress layer bars
function animateLayer(layerIndex, durationMs, startPct = 0, endPct = 100) {
  return new Promise((resolve) => {
    const stepEl = document.getElementById(`layerStep${layerIndex}`);
    const fillEl = document.getElementById(`layerFill${layerIndex}`);
    const pctEl = document.getElementById(`layerPct${layerIndex}`);
    
    if (!stepEl || !fillEl || !pctEl) {
      resolve();
      return;
    }
    
    stepEl.classList.remove('completed', 'failed');
    stepEl.classList.add('active');
    stepEl.style.opacity = '1';
    
    const startTime = performance.now();
    
    function update() {
      const now = performance.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      
      const currentPct = Math.round(startPct + (endPct - startPct) * progress);
      fillEl.style.width = `${currentPct}%`;
      pctEl.textContent = `${currentPct}%`;
      
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        if (endPct === 100) {
          stepEl.classList.remove('active');
          stepEl.classList.add('completed');
        }
        resolve();
      }
    }
    requestAnimationFrame(update);
  });
}

async function submitCheckout(e) {
  e.preventDefault();

  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const house = document.getElementById('custHouse').value.trim();
  const street = document.getElementById('custAddress').value.trim();
  const address = `${house}, ${street}`;
  const areaSelect = document.getElementById('custArea');
  const areaLabel = areaSelect.options[areaSelect.selectedIndex].text;
  
  const paymentMethod = document.querySelector('input[name="payOpt"]:checked').value;

  const subtotal = cartItems.reduce((acc, item) => {
    const discountInfo = getDiscountedPrice(item);
    return acc + (Math.round(discountInfo.price) * item.quantity);
  }, 0);
  
  const referralDiscount = appliedReferralCode ? Math.round(subtotal * 0.1) : 0;
  const deliveryCharge = areaSelect.value === 'inside' ? 60 : 120;
  const totalPrice = Math.max(0, subtotal - referralDiscount + deliveryCharge);

  let itemsSummary = cartItems.map(item => `${item.quantity} x ${item.title} (${item.brand})`).join(', ');
  if (appliedReferralCode) {
    itemsSummary += ` | [Referral: ${appliedReferralCode}]`;
  }

  const statusScreen = document.getElementById('checkoutStatusScreen');
  const spinner = document.getElementById('statusSpinner');
  const successIcon = document.getElementById('successIcon');
  const statusTitle = document.getElementById('statusTitle');
  const statusDesc = document.getElementById('statusDesc');
  const statusBtn = document.getElementById('statusActionBtn');

  statusScreen.classList.add('active');
  spinner.style.display = 'block';
  successIcon.style.display = 'none';
  statusTitle.textContent = "Processing Order...";
  statusBtn.style.display = 'none';

  // Reset all steps
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`layerStep${i}`);
    const fillEl = document.getElementById(`layerFill${i}`);
    const pctEl = document.getElementById(`layerPct${i}`);
    if (stepEl) {
      stepEl.classList.remove('active', 'completed', 'failed');
    }
    if (fillEl) {
      fillEl.style.width = '0%';
      fillEl.style.backgroundColor = ''; 
    }
    if (pctEl) {
      pctEl.textContent = '0%';
    }
  }

  const orderId = "SHC-" + Math.floor(100000 + Math.random() * 900000);

  try {
    // 1. Bag Validation (600ms)
    statusDesc.textContent = "Verifying items, stock levels, and delivery options...";
    await animateLayer(1, 600, 0, 100);

    // 2. Security Check (600ms)
    statusDesc.textContent = "Encrypting transaction payload and verifying session keys...";
    await animateLayer(2, 600, 0, 100);

    // 3. Database Registry
    statusDesc.textContent = "Writing order records securely to the Shuchi database...";
    const step3Animation = animateLayer(3, 800, 0, 80);
    
    const insertPromise = (async () => {
      // Auto register / log-in guest users
      if (!currentUser) {
        try {
          const { data: existingUser, error: checkError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();

          if (!checkError && existingUser) {
            saveUserState({
              name: existingUser.name,
              phone: existingUser.phone,
              address: existingUser.address
            });
          } else {
            const { error: insertError } = await supabaseClient
              .from('profiles')
              .insert([{ 
                name, 
                phone, 
                address,
                created_at: new Date().toISOString()
              }]);
            
            if (!insertError) {
              saveUserState({ name, phone, address });
            }
          }
        } catch (authErr) {
          console.warn("Auto sign-in failed during checkout:", authErr);
        }
      } else {
        // If already logged in, update address/name if changed
        try {
          if (currentUser.name !== name || currentUser.address !== address) {
            const { error: updateError } = await supabaseClient
              .from('profiles')
              .update({ name, address })
              .eq('phone', phone);
            if (!updateError) {
              saveUserState({ name, phone, address });
            }
          }
        } catch (updateErr) {
          console.warn("Profile update failed during checkout:", updateErr);
        }
      }

      const { error } = await supabaseClient
        .from('orders')
        .insert([{
          order_id: orderId,
          customer_name: name,
          phone: phone,
          address: address,
          area: areaLabel,
          payment_method: paymentMethod,
          items: itemsSummary,
          total_price: totalPrice,
          created_at: new Date().toISOString()
        }]);
      if (error) throw error;
    })();

    await Promise.all([step3Animation, insertPromise]);
    await animateLayer(3, 300, 80, 100);

    // 4. Finalizing Order & Dispatch (600ms)
    statusDesc.textContent = "Clearing bag cache and generating Shuchi Dispatch manifest...";
    await animateLayer(4, 600, 0, 100);

    cartItems = [];
    saveCartState();
    appliedReferralCode = null;

    spinner.style.display = 'none';
    successIcon.style.display = 'flex';
    statusTitle.textContent = "Order Placed Successfully!";
    statusDesc.textContent = `Thank you for shopping with SHUCHI. Your Order ID is ${orderId}. We have registered this order on the Shuchi User database and will contact you via phone within 24 hours.`;
    
    statusBtn.textContent = "Continue Shopping";
    statusBtn.onclick = closeCheckoutAfterSuccess;
    statusBtn.style.display = 'block';
  } catch (err) {
    console.error("Order submit failed:", err);
    
    let failedIndex = 3;
    for (let i = 1; i <= 4; i++) {
      const step = document.getElementById(`layerStep${i}`);
      if (step && !step.classList.contains('completed')) {
        failedIndex = i;
        break;
      }
    }
    
    const failedStep = document.getElementById(`layerStep${failedIndex}`);
    if (failedStep) {
      failedStep.classList.remove('active');
      failedStep.classList.add('failed');
      const fillEl = document.getElementById(`layerFill${failedIndex}`);
      if (fillEl) fillEl.style.width = '100%';
    }

    spinner.style.display = 'none';
    statusTitle.textContent = "Order Submission Failed";
    statusDesc.textContent = `There was a Shuchi database connection issue: ${err.message || err.toString()}. Please verify your network and click retry or contact support.`;
    
    statusBtn.textContent = "Close & Retry";
    statusBtn.onclick = function() {
      statusScreen.classList.remove('active');
    };
    statusBtn.style.display = 'block';
  }
}

function closeCheckoutAfterSuccess() {
  document.getElementById('checkoutForm').reset();
  const statusScreen = document.getElementById('checkoutStatusScreen');
  if (statusScreen) statusScreen.classList.remove('active');
  closeCheckout();
  window.location.href = "storefront.html";
}

// ── PRODUCT DETAILS CONTINUOUS STOREFRONT BROWSING ──
async function injectStorefrontCatalogOnDetails() {
  const discoverSection = document.getElementById('discover-products');
  if (!discoverSection) return;

  // Render a clean storefront section
  discoverSection.innerHTML = `
    <div style="margin-bottom: 3rem;">
      <p class="section-label">Discover More Skincare</p>
      <h2 class="section-title">Continue browsing<br><em>our collection.</em></h2>
    </div>
    <div class="products-grid" id="detailStorefrontGrid">
      <p style="grid-column: 1/-1; text-align: center; color: var(--sage); padding: 3rem;">Loading storefront...</p>
    </div>
  `;

  const SHEET_READ_URL = "https://script.google.com/macros/s/AKfycbwkKY-U-TgaEBjQpNThCj62emm1awB1LCoa6tNeKAZC2--DfQOnemcsIgmRfwgoeMhF/exec";
  const grid = document.getElementById('detailStorefrontGrid');

  // Load products list from cache or live API
  let products = [];
  const cached = sessionStorage.getItem('shuchi_products');
  if (cached) {
    try {
      products = JSON.parse(cached);
    } catch(e) {}
  }

  // Helper render
  const renderList = (prods) => {
    grid.innerHTML = '';
    
    // Helper to classify category for recommendations
    const classifyProductTypeForRecs = (title, desc) => {
      const t = (title || '').toLowerCase();
      const d = (desc || '').toLowerCase();
      if (t.includes('shampoo') || t.includes('conditioner') || t.includes('hair')) return 'Shampoo';
      if (t.includes('body wash') || t.includes('shower gel') || t.includes('body cleanser')) return 'Body Wash';
      if (t.includes('body cream') || t.includes('body lotion')) return 'Body Cream';
      if (t.includes('sunscreen') || t.includes('sun cream') || t.includes('sunblock') || t.includes('sun stick')) return 'Sunscreen';
      if (t.includes('cleansing oil') || t.includes('oil cleanser') || t.includes('cleansing balm') || t.includes('micellar') || t.includes('makeup remover')) return 'Cleanser';
      if (t.includes('facewash') || t.includes('face wash') || t.includes('foam cleanser') || t.includes('foaming')) return 'Facewash';
      if (t.includes('toner') || t.includes('skin refiner') || t.includes('toning')) return 'Toner';
      if (t.includes('essence') || t.includes('mucin') || t.includes('serum') || t.includes('ampoule')) return 'Essence & Serum';
      if (t.includes('lotion') || t.includes('emulsion')) return 'Lotion';
      if (t.includes('cream') || t.includes('gel cream') || t.includes('moisturizer') || t.includes('sleeping mask')) return 'Cream';
      
      if (d.includes('shampoo') || d.includes('hair')) return 'Shampoo';
      if (d.includes('body wash') || d.includes('shower gel')) return 'Body Wash';
      if (d.includes('body cream') || d.includes('body lotion')) return 'Body Cream';
      if (d.includes('sunscreen') || d.includes('sun cream')) return 'Sunscreen';
      if (d.includes('cleansing oil') || d.includes('cleansing balm')) return 'Cleanser';
      if (d.includes('facewash') || d.includes('face wash') || d.includes('cleansing foam')) return 'Facewash';
      if (d.includes('toner')) return 'Toner';
      if (d.includes('essence') || d.includes('serum') || d.includes('ampoule')) return 'Essence & Serum';
      if (d.includes('lotion') || d.includes('emulsion')) return 'Lotion';
      if (d.includes('cream') || d.includes('moisturizer')) return 'Cream';
      return 'Other';
    };

    const urlParams = new URLSearchParams(window.location.search);
    let currId = document.body.dataset.productId || urlParams.get('id') || '';
    if (!currId) {
      const path = window.location.pathname;
      const pathMatch = path.match(/\/([^/]+)\.html$/) || path.match(/\/([^/]+)$/);
      if (pathMatch && pathMatch[1] !== 'product') {
        currId = pathMatch[1];
      }
    }
    const currBaseId = getBaseProductId(currId);
    
    // Find current product attributes
    const currentProduct = prods.find(p => p.id === currId);
    let currBrand = '';
    let currType = '';
    if (currentProduct) {
      const normCurr = {};
      Object.keys(currentProduct).forEach(k => { normCurr[k.trim().toLowerCase()] = currentProduct[k]; });
      currBrand = (normCurr.brand || '').trim().toLowerCase();
      currType = classifyProductTypeForRecs(normCurr.title, normCurr.desc);
    }

    const seen = new Set();
    if (currBaseId) seen.add(currBaseId);

    // Score products relative to the current product
    const scored = prods.map(p => {
      const pNorm = {};
      Object.keys(p).forEach(k => { pNorm[k.trim().toLowerCase()] = p[k]; });
      const pBrand = (pNorm.brand || '').trim().toLowerCase();
      const pType = classifyProductTypeForRecs(pNorm.title, pNorm.desc);
      
      let score = 0;
      if (currBrand && pBrand === currBrand) score += 10;
      if (currType && pType === currType && pType !== 'Other') score += 5;
      
      return { ...p, score };
    }).sort((a, b) => b.score - a.score);

    const filtered = [];
    scored.forEach(p => {
      const baseId = getBaseProductId(p.id);
      if (!seen.has(baseId)) {
        seen.add(baseId);
        filtered.push(p);
      }
    });

    const sliced = filtered.slice(0, 4); // show top 4 best matches

    if (sliced.length === 0) {
      grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-soft);">No other products available right now.</p>';
      return;
    }

    sliced.forEach(product => {
      const p = {};
      Object.keys(product).forEach(k => { p[k.trim().toLowerCase()] = product[k]; });
      if (!p.id) return;

      const pTitle = p.title || '[Title]';
      const pBrand = p.brand || '[Brand]';
      const pDesc = p.desc || '';
      const pPrice = p.price || '';
      const pImage = p.image || p.img || p.imageurl || p.imgurl || p.photo || '';
      
      const imgHTML = pImage ? 
        `<img src="${pImage}" alt="${pTitle}" style="width: 100%; height: 100%; object-fit: contain; padding: 1.5rem; display: block;" onerror="handleImgError(this)">` :
        `<svg width="50" height="76" viewBox="0 0 50 76" fill="none">
          <rect x="11" y="8" width="28" height="62" rx="4" fill="#A8C4A2" opacity="0.5"/>
          <rect x="16" y="3" width="18" height="8" rx="2" fill="#6B8F6B" opacity="0.4"/>
        </svg>`;

      const baseId = getBaseProductId(p.id);
      const hasVariants = products && products.filter(item => getBaseProductId(item.id || item.ID || item.Id) === baseId).length > 1;
      const variantsBadge = hasVariants ? `<span class="product-badge options-badge">✦ Options Available</span>` : '';
      
      const inStock = p.stock !== false && p.stock !== 'false';
      const actionButtons = inStock ? 
        `<button class="card-btn-add" onclick="addToCart('${p.id}', '${pTitle.replace(/'/g, "\\'")}', '${pBrand.replace(/'/g, "\\'")}', '${pPrice}', '${pImage}')">Add To Bag</button>
         <button class="card-btn-buy" onclick="buyNow('${p.id}', '${pTitle.replace(/'/g, "\\'")}', '${pBrand.replace(/'/g, "\\'")}', '${pPrice}', '${pImage}')">Buy Now</button>` :
        `<button class="card-btn-outofstock" disabled style="width: 100%; padding: 0.6rem 1rem; background: var(--cream-deep); color: var(--text-soft); border: 1.5px solid var(--cream-deep); border-radius: 4px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; cursor: not-allowed; min-height: 38px;">Restocking Soon</button>`;

      const stockBadge = inStock ? '' : `<span class="product-badge out-of-stock" style="background: var(--dark-mid); opacity: 0.85; right: 1rem; left: auto; font-size: 0.62rem;">Restocking Soon</span>`;

      const cardHTML = `
        <div class="product-card">
          <a href="./${p.id}.html" style="text-decoration: none; color: inherit; display: block;">
            <div class="product-card-img">
              <span class="product-badge authentic">✓ Direct Import</span>
              ${variantsBadge}
              ${stockBadge}
              ${imgHTML}
            </div>
            <div class="product-card-body" style="padding: 1.5rem;">
              <p class="product-brand">${pBrand}</p>
              <h3 class="product-title-card">${pTitle}</h3>
              <p class="product-desc-card">${pDesc.substring(0, 65)}${pDesc.length > 65 ? '...' : ''}</p>
              <div class="product-footer-card">
                <span class="product-price">৳ ${pPrice}</span>
              </div>
            </div>
          </a>
          <div class="product-card-actions" style="padding: 0 1.5rem 1.5rem;">
            ${actionButtons}
          </div>
        </div>
      `;
      grid.insertAdjacentHTML('beforeend', cardHTML);
    });
  };

  if (products.length > 0) {
    renderList(products);
  } else {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
        <svg class="logo-loader" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
          <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
          <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
          <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
          <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
        </svg>
        <p style="color: var(--sage); font-size: 0.85rem; letter-spacing: 0.05em; margin-top: 1rem;">Loading storefront...</p>
      </div>
    `;
  }

  // Background refresh list
  try {
    const liveProducts = await fetchProductsWithRetry();
    sessionStorage.setItem('shuchi_products', JSON.stringify(liveProducts));
    renderList(liveProducts);
  } catch (err) {
    console.error("Failed to load details storefront catalog:", err);
    if (products.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-soft); padding: 3rem;">
          <p style="margin-bottom: 1rem;">Unable to load other products right now.</p>
          <button class="wiki-btn" onclick="injectStorefrontCatalogOnDetails()" style="pointer-events: auto;">Try Again</button>
        </div>
      `;
    }
  }
}

// ── FLOATING REGISTRATION PROMPT (USER CONVERSION UX) ──
function initRegistrationPrompt() {
  const userState = localStorage.getItem('shuchi_user') || getCookie('shuchi_user');
  if (userState) return;
  if (sessionStorage.getItem('shuchi_reg_prompt_dismissed')) return;

  setTimeout(() => {
    if (localStorage.getItem('shuchi_user') || getCookie('shuchi_user')) return;

    const style = document.createElement('style');
    style.textContent = `
      .shuchi-reg-prompt {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: var(--white, #FAFAF7);
        border: 1.5px solid var(--sage-light, #A8C4A2);
        box-shadow: 0 15px 35px rgba(26, 43, 27, 0.15);
        padding: 1.5rem;
        border-radius: 8px;
        z-index: 1000;
        max-width: 340px;
        width: calc(100% - 4rem);
        transform: translateY(40px);
        opacity: 0;
        transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }
      .shuchi-reg-prompt.show {
        transform: translateY(0);
        opacity: 1;
      }
      .shuchi-reg-prompt-title {
        font-family: Georgia, serif;
        font-size: 1.1rem;
        color: var(--dark, #1A2B1B);
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .shuchi-reg-prompt-close {
        background: none;
        border: none;
        font-size: 1.2rem;
        color: var(--text-soft, #5A6E5B);
        cursor: pointer;
        transition: color 0.2s;
        line-height: 1;
      }
      .shuchi-reg-prompt-close:hover {
        color: var(--dark, #1A2B1B);
      }
      .shuchi-reg-prompt-desc {
        font-size: 0.8rem;
        color: var(--text-soft, #5A6E5B);
        line-height: 1.5;
      }
      .shuchi-reg-prompt-actions {
        display: flex;
        gap: 0.8rem;
        margin-top: 0.4rem;
      }
      .shuchi-reg-prompt-btn {
        background: var(--dark, #1A2B1B);
        color: var(--cream, #F5EFE4);
        border: none;
        padding: 0.5rem 1.2rem;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 600;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.3s;
      }
      .shuchi-reg-prompt-btn:hover {
        background: var(--sage, #6B8F6B);
        color: var(--white, #FAFAF7);
      }
      .shuchi-reg-prompt-btn-secondary {
        background: transparent;
        color: var(--text-soft, #5A6E5B);
        border: 1px solid var(--cream-deep, #EDE4D4);
        padding: 0.5rem 1.2rem;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 500;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.3s;
      }
      .shuchi-reg-prompt-btn-secondary:hover {
        border-color: var(--text-soft, #5A6E5B);
        color: var(--dark, #1A2B1B);
      }
      @media (max-width: 600px) {
        .shuchi-reg-prompt {
          bottom: 1.5rem;
          right: 1.5rem;
          left: 1.5rem;
          width: auto;
          max-width: none;
        }
      }
    `;
    document.head.appendChild(style);

    const promptDiv = document.createElement('div');
    promptDiv.className = 'shuchi-reg-prompt';
    promptDiv.id = 'shuchiRegPrompt';
    promptDiv.innerHTML = `
      <div class="shuchi-reg-prompt-title">
        <span>Create your Shuchi Account</span>
        <button class="shuchi-reg-prompt-close" onclick="dismissRegPrompt()">×</button>
      </div>
      <div class="shuchi-reg-prompt-desc">
        Register in 10 seconds to save checkout time, track order history, and personalize your skincare routines.
      </div>
      <div class="shuchi-reg-prompt-actions">
        <button class="shuchi-reg-prompt-btn" onclick="triggerRegPromptSignUp()">Create Account</button>
        <button class="shuchi-reg-prompt-btn-secondary" onclick="dismissRegPrompt()">Maybe Later</button>
      </div>
    `;
    document.body.appendChild(promptDiv);

    setTimeout(() => promptDiv.classList.add('show'), 50);
  }, 4000);
}

function dismissRegPrompt() {
  const promptDiv = document.getElementById('shuchiRegPrompt');
  if (promptDiv) {
    promptDiv.classList.remove('show');
    setTimeout(() => promptDiv.remove(), 500);
  }
  sessionStorage.setItem('shuchi_reg_prompt_dismissed', 'true');
}

function triggerRegPromptSignUp() {
  dismissRegPrompt();
  if (typeof toggleAuthModal === 'function') {
    toggleAuthModal();
  }
}

// Fire the initializer when the DOM content loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCartSystem);
} else {
  initCartSystem();
}
