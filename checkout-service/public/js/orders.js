const CHECKOUT_API_BASE = 'http://localhost:3003/api/checkout';

// Get userId from URL or localStorage
const urlParams = new URLSearchParams(window.location.search);
let USER_ID = urlParams.get('userId');

if (!USER_ID) {
  USER_ID = localStorage.getItem('shophub_userId');
  if (!USER_ID) {
    USER_ID = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('shophub_userId', USER_ID);
  }
}

// DOM Elements
const loading = document.getElementById('loading');
const noOrders = document.getElementById('noOrders');
const ordersList = document.getElementById('ordersList');
const orderModal = document.getElementById('orderModal');
const modalBody = document.getElementById('modalBody');
const closeModal = document.getElementById('closeModal');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Display current userId
  document.getElementById('currentUserId').textContent = USER_ID;

  loadOrders();
  closeModal.addEventListener('click', () => {
    orderModal.classList.add('hidden');
    orderModal.style.display = 'none';
  });

  // Close modal on outside click
  orderModal.addEventListener('click', (e) => {
    if (e.target === orderModal) {
      orderModal.classList.add('hidden');
      orderModal.style.display = 'none';
    }
  });
});

async function loadOrders() {
  showLoading();

  console.log('Loading orders for userId:', USER_ID);

  try {
    const response = await fetch(`${CHECKOUT_API_BASE}/orders/${USER_ID}`);

    if (!response.ok) {
      throw new Error('Failed to load orders');
    }

    const result = await response.json();
    console.log('Orders API response:', result);

    if (result.success && result.data && result.data.length > 0) {
      renderOrders(result.data);
    } else {
      console.log('No orders found for this user');
      showNoOrders();
    }
  } catch (err) {
    console.error('Error loading orders:', err);
    showNoOrders();
  }
}

function renderOrders(orders) {
  hideLoading();
  noOrders.classList.add('hidden');
  ordersList.classList.remove('hidden');

  ordersList.innerHTML = orders.map(order => {
    const statusClass = (order.status || 'confirmed').toLowerCase();
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const date = formatDate(order.created_at || order.createdAt);
    const totalINR = Math.round((order.total || 0) * 83);
    const items = parseOrderItems(order);

    return `
      <div class="order-card" onclick="viewOrder('${order.order_id || order.orderId}')">
        <div class="order-header">
          <div>
            <div class="order-id">${order.order_id || order.orderId}</div>
            <div class="order-date">${date}</div>
          </div>
          <span class="order-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="order-items-preview">
          ${items.slice(0, 4).map(item => `
            <img src="${item.image || ''}" alt="${item.name}" class="order-item-thumb" onerror="this.onerror=null;this.src='https://via.placeholder.com/60x60?text=No+Image';">
          `).join('')}
          ${items.length > 4 ? `<span class="order-item-thumb" style="display:flex;align-items:center;justify-content:center;background:#ecf0f1;color:#7f8c8d;font-size:12px;">+${items.length - 4}</span>` : ''}
        </div>
        <div class="order-footer">
          <div class="order-total">
            ₹${totalINR.toLocaleString('en-IN')}
            <span> · ${items.length} item${items.length !== 1 ? 's' : ''}</span>
          </div>
          <button class="btn btn-primary" onclick="event.stopPropagation(); viewOrder('${order.order_id || order.orderId}')">
            View Details
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function parseOrderItems(order) {
  // If items array is already populated (from the API)
  if (order.items && Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map(item => ({
      id: item.id || item.product_id,
      productId: item.product_id || item.productId,
      name: item.name,
      price: parseFloat(item.price || 0),
      quantity: parseInt(item.quantity || 1),
      subtotal: parseFloat(item.subtotal || 0),
      image: item.image || ''
    }));
  }

  // Fallback: create placeholder items from item_ids string
  if (order.item_ids) {
    return order.item_ids.split(',').map((id, i) => ({
      id: id,
      name: `Item ${i + 1}`,
      price: 0,
      quantity: 1,
      image: ''
    }));
  }

  return [];
}

async function viewOrder(orderId) {
  try {
    const response = await fetch(`${CHECKOUT_API_BASE}/order/${orderId}`);

    if (!response.ok) {
      throw new Error('Failed to load order details');
    }

    const result = await response.json();
    console.log('Order details response:', result);

    if (result.success) {
      showOrderDetails(result.data);
    }
  } catch (err) {
    console.error('Error loading order:', err);
    alert('Failed to load order details');
  }
}

function showOrderDetails(order) {
  console.log('Showing order details:', order);
  console.log('Order items:', order.items);

  const statusClass = (order.status || 'confirmed').toLowerCase();
  const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
  const date = formatDate(order.created_at || order.createdAt);
  const items = parseOrderItems(order);

  console.log('Parsed items:', items);

  const subtotalINR = Math.round((order.subtotal || 0) * 83);
  const discountINR = Math.round((order.discount || 0) * 83);
  const taxINR = Math.round((order.tax_amount || order.tax || 0) * 83);
  const shippingINR = Math.round((order.shipping_cost || 0) * 83);
  const totalINR = Math.round((order.total || 0) * 83);

  // Parse shipping address (stored as JSON string)
  let shippingAddressText = '';
  if (order.shipping_address) {
    try {
      const addr = typeof order.shipping_address === 'string'
        ? JSON.parse(order.shipping_address)
        : order.shipping_address;
      shippingAddressText = `${addr.name || ''}, ${addr.address || ''}, ${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`;
    } catch (e) {
      shippingAddressText = order.shipping_address;
    }
  }

  modalBody.innerHTML = `
    <div class="modal-order-info">
      <p><strong>Order ID:</strong> ${order.order_id || order.orderId}</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Status:</strong> <span class="order-status ${statusClass}">${statusLabel}</span></p>
      <p><strong>Payment:</strong> ${order.payment_method || 'N/A'} - ${order.payment_status || 'N/A'}</p>
      ${shippingAddressText ? `<p><strong>Shipping to:</strong> ${shippingAddressText}</p>` : ''}
    </div>
    <div class="modal-items">
      ${items.map(item => {
        const priceINR = Math.round((item.price || 0) * 83);
        const itemTotal = priceINR * (item.quantity || 1);
        return `
          <div class="modal-item">
            <img src="${item.image || ''}" alt="${item.name}" onerror="this.onerror=null;this.src='https://via.placeholder.com/50x50?text=No+Image';">
            <div class="modal-item-info">
              <div class="modal-item-name">${item.name}</div>
              <div class="modal-item-qty">Qty: ${item.quantity || 1}</div>
            </div>
            <div class="modal-item-price">₹${itemTotal.toLocaleString('en-IN')}</div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="modal-totals">
      <div class="summary-row">
        <span>Subtotal</span>
        <span>₹${subtotalINR.toLocaleString('en-IN')}</span>
      </div>
      ${discountINR > 0 ? `
      <div class="summary-row">
        <span>Discount</span>
        <span>-₹${discountINR.toLocaleString('en-IN')}</span>
      </div>
      ` : ''}
      <div class="summary-row">
        <span>Tax</span>
        <span>₹${taxINR.toLocaleString('en-IN')}</span>
      </div>
      <div class="summary-row">
        <span>Shipping</span>
        <span>${shippingINR === 0 ? 'FREE' : '₹' + shippingINR.toLocaleString('en-IN')}</span>
      </div>
      <div class="summary-row total">
        <span>Total</span>
        <span>₹${totalINR.toLocaleString('en-IN')}</span>
      </div>
    </div>
  `;

  orderModal.classList.remove('hidden');
  orderModal.style.display = 'flex';
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showLoading() {
  loading.classList.remove('hidden');
  noOrders.classList.add('hidden');
  ordersList.classList.add('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showNoOrders() {
  hideLoading();
  noOrders.classList.remove('hidden');
  ordersList.classList.add('hidden');
}
