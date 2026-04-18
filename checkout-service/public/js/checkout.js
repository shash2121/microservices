// Checkout Service Frontend
// This script handles loading the cart, creating a checkout session,
// managing shipping address, applying discounts, and placing the order.

const API_BASE = 'http://localhost:3002/api/cart';
const CHECKOUT_API_BASE = 'http://localhost:3003/api/checkout';

// ---------------------------------------------------------------------
// Utility: Get user identifier (persisted in localStorage)
// ---------------------------------------------------------------------
function getUserId() {
  const urlParams = new URLSearchParams(window.location.search);
  let uid = urlParams.get('userId');
  if (!uid) {
    uid = localStorage.getItem('shophub_userId') || `user_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('shophub_userId', uid);
  }
  return uid;
}

const USER_ID = getUserId();

let cart = null;               // Raw cart data from cart service
let checkoutSession = null;    // Session object returned by checkout service
let appliedDiscount = 0;       // Discount amount in INR (calculated locally when needed)

// ---------------------------------------------------------------------
// DOM references (assumes the HTML structure from the original project)
// ---------------------------------------------------------------------
const loading = document.getElementById('loading');
const emptyCart = document.getElementById('emptyCart');
const checkoutContent = document.getElementById('checkoutContent');
const summaryItems = document.getElementById('summaryItems');
const subtotalEl = document.getElementById('subtotal');
const discountEl = document.getElementById('discount');
const shippingEl = document.getElementById('shipping');
const taxEl = document.getElementById('tax');
const totalEl = document.getElementById('total');
const shippingForm = document.getElementById('shippingForm');
const placeOrderBtn = document.getElementById('placeOrder');
const applyDiscountBtn = document.getElementById('applyDiscount');
const discountCodeInput = document.getElementById('discountCode');
const discountMessage = document.getElementById('discountMessage');
const successModal = document.getElementById('successModal');
const confirmModal = document.getElementById('confirmModal');
const cardDetails = document.getElementById('cardDetails');

// ---------------------------------------------------------------------
// Initialise page
// ---------------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadCart();
    setupEventListeners();
  });
} else {
  loadCart();
  setupEventListeners();
}

function setupEventListeners() {
  // Shipping address form
  shippingForm.addEventListener('submit', handleShippingSubmit);

  // Place order – show confirmation modal first
  placeOrderBtn.addEventListener('click', showConfirmModal);

   // Confirmation modal actions
   document.getElementById('confirmYes').addEventListener('click', async () => {
     console.log('ConfirmYes clicked');
     confirmModal.classList.add('hidden');
     await processOrder();
   });
  document.getElementById('confirmNo').addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  // Discount handling
  applyDiscountBtn.addEventListener('click', handleApplyDiscount);

  // Payment method toggle (card vs cash)
  document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.addEventListener('change', e => {
      cardDetails.style.display = e.target.value === 'card' ? 'block' : 'none';
    });
  });
}

function showConfirmModal() {
  console.log('showConfirmModal called');
  const address = getShippingAddressFromForm();
  const required = ['name', 'email', 'address', 'city', 'state', 'pincode', 'phone'];
  for (const field of required) {
    if (!address[field]) {
      alert('Please fill in all shipping address fields');
      shippingForm.scrollIntoView({ behavior: 'smooth' });
      return;
    }
  }
  console.log('Address valid, showing confirmModal');
  confirmModal.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Cart loading & checkout session creation
// ---------------------------------------------------------------------
async function loadCart() {
  showLoading();
  try {
    const resp = await fetch(`${API_BASE}/${USER_ID}`);
    if (!resp.ok) throw new Error('Failed to load cart');
    const result = await resp.json();
    if (result.success && result.data.items && result.data.items.length) {
      cart = result.data;
      await createCheckoutSession();
      showCheckoutContent();
    } else {
      showEmptyCart();
    }
  } catch (e) {
    console.error(e);
    showEmptyCart();
  }
}

// Create a checkout session on the backend, sending the cart items.
async function createCheckoutSession() {
  try {
    const resp = await fetch(`${CHECKOUT_API_BASE}/session/${USER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart.items })
    });
    const data = await resp.json();
    if (data.success) {
      checkoutSession = data.data;
    } else {
      console.error('Checkout session creation failed:', data.error);
    }
  } catch (e) {
    console.error('Error creating checkout session:', e);
  }
}

function showLoading() {
  loading.classList.remove('hidden');
  emptyCart.classList.add('hidden');
  checkoutContent.classList.add('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showEmptyCart() {
  hideLoading();
  emptyCart.classList.remove('hidden');
  checkoutContent.classList.add('hidden');
}

function showCheckoutContent() {
  hideLoading();
  emptyCart.classList.add('hidden');
  checkoutContent.classList.remove('hidden');
  renderOrderSummary();
}

// ---------------------------------------------------------------------
// Shipping address handling
// ---------------------------------------------------------------------
function getShippingAddressFromForm() {
  return {
    name: document.getElementById('customerName').value,
    email: document.getElementById('customerEmail').value,
    address: document.getElementById('address').value,
    city: document.getElementById('city').value,
    state: document.getElementById('state').value,
    pincode: document.getElementById('pincode').value,
    phone: document.getElementById('phone').value
  };
}

async function handleShippingSubmit(e) {
  e.preventDefault();
  const address = getShippingAddressFromForm();
  const required = ['name', 'email', 'address', 'city', 'state', 'pincode', 'phone'];
  for (const f of required) {
    if (!address[f]) {
      alert('Please fill in all shipping address fields');
      return;
    }
  }
  try {
    const resp = await fetch(`${CHECKOUT_API_BASE}/session/${USER_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_shipping', shippingAddress: address })
    });
    const data = await resp.json();
    if (data.success) {
      checkoutSession = data.data;
      renderOrderSummary();
      alert('Shipping address updated!');
    } else {
      alert(data.error || 'Failed to update address');
    }
  } catch (err) {
    console.error(err);
    alert('Error updating shipping address');
  }
}

// ---------------------------------------------------------------------
// Discount handling (backend first, fallback to local calculation)
// ---------------------------------------------------------------------
async function handleApplyDiscount() {
  const code = discountCodeInput.value.trim().toUpperCase();
  if (!code) return showDiscountMessage('Enter a coupon code', 'error');
  try {
    const resp = await fetch(`${CHECKOUT_API_BASE}/session/${USER_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply_discount', discountCode: code })
    });
    const data = await resp.json();
    if (data.success) {
      appliedDiscount = data.data.discount;
      checkoutSession = data.data;
      renderOrderSummary();
      showDiscountMessage(`Discount applied! Saved ₹${appliedDiscount.toLocaleString()}`, 'success');
    } else {
      showDiscountMessage(data.error || 'Invalid coupon', 'error');
    }
  } catch (e) {
    // Fallback to local discount rules
    applyDiscountLocally(code);
  }
}

function applyDiscountLocally(code) {
  const discounts = {
    WELCOME10: 0.10,
    SAVE20: 0.20,
    FLAT500: 500
  };
  const subtotal = (checkoutSession?.subtotal || cart.totalPrice * 83) || 0;
  if (!discounts[code]) return showDiscountMessage('Invalid coupon', 'error');
  const val = discounts[code];
  if (val < 1) {
    if (code === 'SAVE20' && subtotal < 5000) return showDiscountMessage('Minimum order ₹5,000 required', 'error');
    appliedDiscount = Math.round(subtotal * val);
  } else {
    if (code === 'FLAT500' && subtotal < 3000) return showDiscountMessage('Minimum order ₹3,000 required', 'error');
    appliedDiscount = Math.min(val, subtotal);
  }
  renderOrderSummary();
  showDiscountMessage(`Discount applied! Saved ₹${appliedDiscount.toLocaleString()}`, 'success');
}

function showDiscountMessage(msg, type) {
  discountMessage.textContent = msg;
  discountMessage.className = `discount-message ${type}`;
  discountMessage.style.display = 'block';
  setTimeout(() => (discountMessage.style.display = 'none'), 4000);
}

// ---------------------------------------------------------------------
// Order summary rendering (prices are stored in INR)
// ---------------------------------------------------------------------
function renderOrderSummary() {
  if (!checkoutSession) return;
  // Items list
  summaryItems.innerHTML = checkoutSession.items.map(item => {
    const priceInINR = Math.round(item.price * 83);
    return `<div class="summary-item">
      <img src="${item.image}" alt="${item.name}" class="summary-item-image" onerror="this.src='https://via.placeholder.com/60x60?text=No+Image'"/>
      <div class="summary-item-details">
        <div class="summary-item-name">${item.name}</div>
        <div class="summary-item-quantity">Qty: ${item.quantity}</div>
      </div>
      <div class="summary-item-price">₹${(priceInINR * item.quantity).toLocaleString()}</div>
    </div>`;
  }).join('');

  const usdToInr = 83;
  const subtotalINR = Math.round((checkoutSession.subtotal || (cart?.totalPrice || 0)) * usdToInr);
  const discountINR = Math.round((checkoutSession.discount || appliedDiscount) * usdToInr);
  const taxable = subtotalINR - discountINR;
  const shipping = taxable > 8300 ? 0 : 150;
  const tax = Math.round(taxable * 0.18);
  const total = taxable + tax + shipping;

  subtotalEl.textContent = `₹${subtotalINR.toLocaleString()}`;
  discountEl.textContent = `-₹${discountINR.toLocaleString()}`;
  shippingEl.textContent = shipping === 0 ? 'FREE' : `₹${shipping.toLocaleString()}`;
  taxEl.textContent = `₹${tax.toLocaleString()}`;
  totalEl.textContent = `₹${total.toLocaleString()}`;

  // Store for final order payload
  checkoutSession.shippingCostINR = shipping;
  checkoutSession.taxINR = tax;
  checkoutSession.totalINR = total;
}

// ---------------------------------------------------------------------
// Order placement
// ---------------------------------------------------------------------
async function processOrder() {
  const address = getShippingAddressFromForm();
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
  const paymentDetails = paymentMethod === 'card' ? {
    cardNumber: document.getElementById('cardNumber').value,
    expiry: document.getElementById('expiry').value,
    cvv: document.getElementById('cvv').value,
    cardName: document.getElementById('cardName').value
  } : {};

  placeOrderBtn.disabled = true;
  placeOrderBtn.textContent = 'Processing...';

  try {
    const resp = await fetch(`${CHECKOUT_API_BASE}/session/${USER_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod, paymentDetails, customerEmail: address.email })
    });
    const data = await resp.json();
    if (data.success) {
      await clearCart();
      checkoutSession = null;
      showSuccessModal(data.data.order);
    } else {
      alert(data.error || 'Failed to place order');
    }
  } catch (e) {
    console.error(e);
    alert('Error placing order');
  } finally {
    placeOrderBtn.disabled = false;
    placeOrderBtn.textContent = 'Place Order';
  }
}

async function clearCart() {
  try {
    await fetch(`${API_BASE}/${USER_ID}`, { method: 'DELETE' });
  } catch (e) {
    console.error('Clear cart error', e);
  }
}

function showSuccessModal(order) {
  if (!order) return;
  document.getElementById('orderId').textContent = order.orderId;
  document.getElementById('orderUserId').textContent = USER_ID;
  const totalINR = order.pricing?.total || checkoutSession?.totalINR || 0;
  document.getElementById('orderTotal').textContent = `₹${totalINR.toLocaleString()}`;
  successModal.classList.remove('hidden');
  document.getElementById('viewAllOrdersLink').href = `/orders?userId=${USER_ID}`;
  window.lastOrder = order;
}

