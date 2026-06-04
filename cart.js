// ── SHUCHI SHOPPING CART & AUTHENTICATION SYSTEM ──

// Supabase Database Connection
const SUPABASE_URL = "https://okprwbzfsyvrkpygjkum.supabase.co";
const SUPABASE_KEY = "sb_publishable_LAgGxlaltxGIe6wWu1DBkQ_PJN0DLNG";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global States
let cartItems = [];
let currentUser = null; // { name, phone, address }

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
        .select('*');

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
          image: item.img || ''
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
function initCartSystem() {
  loadCartState();
  loadUserState();
  injectCartUI();
  injectAuthUI();
  injectNavControls();
  updateCartUI();
  updateAuthUI();
  
  // If product.html, inject the storefront catalog at the bottom
  if (window.location.pathname.includes('product.html')) {
    injectStorefrontCatalogOnDetails();
  }
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
            <input type="text" id="custName" class="form-input" required placeholder="e.g. Fatima Rahman">
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
          <div class="checkout-actions">
            <button type="button" class="checkout-cancel-btn" onclick="closeCheckout()">Go Back</button>
            <button type="submit" class="checkout-submit-btn">Place Order</button>
          </div>
        </form>

        <div class="checkout-status-screen" id="checkoutStatusScreen">
          <svg class="logo-loader" id="statusSpinner" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 64px; height: 64px; margin: 0 auto 1.5rem;">
            <path d="M428.393 458.741C397.367 442.352 389.639 455.699 350.257 463.372C297.897 480.729 273.085 493.192 219.832 520.489L270.021 623.63C288.39 656.569 303.786 659.091 332.525 683.826C379.073 693.884 408.435 692.732 468.538 674.586L591.894 632.338L521.57 537.477L428.393 458.741Z" fill="currentColor"/>
            <path d="M573.217 875.61C558.753 907.579 544.465 901.772 508.648 919.854C456.64 938.242 429.398 943.607 370.592 954.689L347.01 842.436C341.328 805.152 351.945 793.721 359.486 756.56C390.094 720.077 413.996 702.986 472.604 680.474L595.96 638.226L598.559 756.283L573.217 875.61Z" fill="currentColor"/>
            <path d="M838.875 684.401C873.212 680.144 872.05 664.541 899.764 635.376C932.621 590.63 945.829 565.89 973.871 512.335L875.613 455.277C842.332 438.408 828.42 445.201 791.288 441.173C747.87 459.682 724.662 477.614 685.954 527.493L609.301 634.042L719.3 672.554L838.875 684.401Z" fill="currentColor"/>
            <path d="M633.551 876.431C648.671 908.629 662.802 902.957 698.928 921.458C751.214 940.435 778.511 946.098 837.423 957.823L858.536 845.541C863.402 808.225 852.564 796.654 844.24 759.324C812.915 722.431 788.698 705.048 729.738 681.868L605.75 638.226L605.698 756.545L633.551 876.431Z" fill="currentColor"/>
            <path d="M478.04 427.924C470.246 393.217 484.887 389.034 502.085 352.27C531.758 305.223 549.852 284.014 589.206 238.634L674.723 314.396C701.444 340.894 699.975 356.68 716.285 391.275C714.156 439.626 705.68 468.205 673.311 522.665L602.112 633.156L529.533 539.712L478.04 427.924Z" fill="currentColor"/>
          </svg>
          <div class="success-icon" id="successIcon" style="display:none;">✓</div>
          <h4 class="status-title" id="statusTitle">Processing Order...</h4>
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
              <input type="text" id="signUpName" class="form-input" required placeholder="Fatima Rahman">
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
                <input type="text" id="editName" class="form-input" required placeholder="e.g. Fatima Rahman">
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

// Switch registration/login tabs in Modal
function switchAuthTab(tab) {
  const tabIn = document.getElementById('tabSignIn');
  const tabUp = document.getElementById('tabSignUp');
  const formIn = document.getElementById('signInForm');
  const formUp = document.getElementById('signUpForm');

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
    alert(`Registration failed: ${err.message || err.toString()}`);
  }
}

// Handle Sign In (Looks up Phone number in Supabase, logs user in via Cookie)
async function submitSignIn(e) {
  e.preventDefault();

  const phone = document.getElementById('signInPhone').value.trim();

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
    alert(`Could not sign in: ${err.message || err.toString()}`);
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
    statusEl.textContent = "Saving changes to the Shuchi User database...";
  }

  try {
    const { error } = await supabaseClient
      .from('profiles')
      .update({ name, address })
      .eq('phone', currentUser.phone);

    if (error) throw error;

    currentUser.name = name;
    currentUser.address = address;
    saveUserState(currentUser);
    updateAuthUI();
    disableProfileEdit();
    showToast("Profile details updated successfully!");
  } catch (err) {
    console.error("Profile edit failed:", err);
    alert(`Failed to update details: ${err.message || err.toString()}`);
  } finally {
    if (statusEl) statusEl.style.display = 'none';
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

      return `
        <div class="order-history-card">
          <div class="order-hist-header">
            <span class="order-hist-id">${order.order_id}</span>
            <span class="order-hist-status ${statusClass}">${formattedStatus}</span>
          </div>
          <div class="order-hist-items">${order.items}</div>
          <div class="order-hist-footer">
            <span>${dateStr}</span>
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

  const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  
  const areaSelect = document.getElementById('custArea');
  const areaValue = areaSelect ? areaSelect.value : 'inside';
  const deliveryCharge = totalQuantity === 0 ? 0 : (areaValue === 'inside' ? 60 : 120);
  const total = subtotal + deliveryCharge;

  subtotalEl.textContent = `৳ ${subtotal.toLocaleString()}`;
  deliveryEl.textContent = `৳ ${deliveryCharge.toLocaleString()}`;
  totalEl.textContent = `৳ ${total.toLocaleString()}`;

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

    return `
      <div class="cart-item">
        <div class="cart-item-img">${imgHTML}</div>
        <div class="cart-item-details">
          <span class="cart-item-brand">${item.brand}</span>
          <h4 class="cart-item-title">${item.title}</h4>
          <div class="cart-item-price">৳ ${item.price.toLocaleString()}</div>
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
    checkoutOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeCheckout() {
  const checkoutOverlay = document.getElementById('checkoutOverlay');
  if (checkoutOverlay) {
    checkoutOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
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

  const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const deliveryCharge = areaSelect.value === 'inside' ? 60 : 120;
  const totalPrice = subtotal + deliveryCharge;

  const itemsSummary = cartItems.map(item => `${item.quantity} x ${item.title} (${item.brand})`).join(', ');

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
  statusDesc.textContent = "Writing order records securely to the Shuchi User database.";
  statusBtn.style.display = 'none';

  const orderId = "SHC-" + Math.floor(100000 + Math.random() * 900000);

  try {
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

    cartItems = [];
    saveCartState();

    spinner.style.display = 'none';
    successIcon.style.display = 'flex';
    statusTitle.textContent = "Order Placed Successfully!";
    statusDesc.textContent = `Thank you for shopping with SHUCHI. Your Order ID is ${orderId}. We have registered this order on the Shuchi User database and will contact you via phone within 24 hours.`;
    
    statusBtn.textContent = "Continue Shopping";
    statusBtn.onclick = closeCheckoutAfterSuccess;
    statusBtn.style.display = 'block';
  } catch (err) {
    console.error("Order submit failed:", err);
    spinner.style.display = 'none';
    statusTitle.textContent = "Order Submission Failed";
    statusDesc.textContent = `There was a Shuchi User database connection issue: ${err.message || err.toString()}. Please verify your network and click retry or contact support.`;
    
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
    // Exclude current product and other variants, showing only unique base products
    const urlParams = new URLSearchParams(window.location.search);
    const currId = urlParams.get('id') || '';
    const currBaseId = getBaseProductId(currId);
    
    const seen = new Set();
    if (currBaseId) seen.add(currBaseId);

    const filtered = [];
    prods.forEach(p => {
      const baseId = getBaseProductId(p.id);
      if (!seen.has(baseId)) {
        seen.add(baseId);
        filtered.push(p);
      }
    });

    const sliced = filtered.slice(0, 6); // show max 6 related items

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

      const cardHTML = `
        <div class="product-card">
          <a href="./${p.id}.html" style="text-decoration: none; color: inherit; display: block;">
            <div class="product-card-img">
              <span class="product-badge authentic">✓ Direct Import</span>
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
            <button class="card-btn-add" onclick="addToCart('${p.id}', '${pTitle.replace(/'/g, "\\'")}', '${pBrand.replace(/'/g, "\\'")}', '${pPrice}', '${pImage}')">Add To Bag</button>
            <button class="card-btn-buy" onclick="buyNow('${p.id}', '${pTitle.replace(/'/g, "\\'")}', '${pBrand.replace(/'/g, "\\'")}', '${pPrice}', '${pImage}')">Buy Now</button>
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

// Fire the initializer when the DOM content loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCartSystem);
} else {
  initCartSystem();
}
