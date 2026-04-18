const express = require('express');
const router = express.Router();
const { CheckoutSession, CheckoutItem } = require('../models/Checkout');
const { getOrdersByUserId, getOrderWithItems } = require('../config/database');
const { cache } = require('../config/redis');

const SESSION_TTL = 1800; // 30 minutes

// ---------------------------------------------------------------------
// Helper functions for Redis session persistence
// ---------------------------------------------------------------------
function createSession(userId, data = null) {
  const session = new CheckoutSession(userId);
  if (data) {
    // Avoid using Object.assign because CheckoutSession has read-only getters (subtotal, total, etc.)
    session.id = data.id || session.id;
    session.status = data.status || 'pending';
    session.discount = data.discount || 0;
    session.discountCode = data.discountCode || null;
    session.shippingCost = data.shippingCost || 0;
    session.shippingAddress = data.shippingAddress || null;
    session.paymentMethod = data.paymentMethod || null;
    session.paymentStatus = data.paymentStatus || 'pending';
    session.createdAt = data.createdAt || session.createdAt;
    session.updatedAt = data.updatedAt || session.updatedAt;
    session.completedAt = data.completedAt || null;

    if (data.items && Array.isArray(data.items)) {
      session.items = data.items.map(i => new CheckoutItem(i.productId, i.name, i.price, i.image, i.quantity));
    }
  }
  return session;
}

async function getSession(userId) {
  const cached = await cache.get(`checkout:${userId}`);
  if (cached) return createSession(userId, cached);
  return null;
}

async function saveSession(userId, session) {
  await cache.set(`checkout:${userId}`, {
    id: session.id,
    userId: session.userId,
    items: session.items.map(i => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      image: i.image,
      quantity: i.quantity
    })),
    subtotal: session.subtotal,
    discount: session.discount,
    discountCode: session.discountCode,
    tax: session.tax,
    shippingCost: session.shippingCost,
    total: session.total,
    status: session.status,
    shippingAddress: session.shippingAddress,
    paymentMethod: session.paymentMethod,
    paymentStatus: session.paymentStatus,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt
  }, SESSION_TTL);
}

async function deleteSession(userId) {
  await cache.del(`checkout:${userId}`);
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------
router.get('/session/:userId', async (req, res) => {
  const session = await getSession(req.params.userId);
  if (!session) return res.status(404).json({ success: false, error: 'No checkout session found' });
  res.json({ success: true, data: session });
});

router.post('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Cart items are required' });
  }
  const session = new CheckoutSession(userId);
  items.forEach(item => {
    session.addItem({
      id: item.productId, // CheckoutSession.addItem expects product.id
      productId: item.productId,
      name: item.name,
      price: item.price,
      image: item.image
    }, item.quantity);
  });
  await saveSession(userId, session);
  res.json({ success: true, data: session });
});

router.put('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  const { action, discountCode, shippingAddress } = req.body;
  const session = await getSession(userId);
  if (!session) return res.status(404).json({ success: false, error: 'Checkout session not found' });
  if (action === 'apply_discount') {
    const result = session.applyDiscount(discountCode);
    if (!result.success) return res.status(400).json(result);
  } else if (action === 'set_shipping') {
    session.calculateShipping(shippingAddress);
  }
  await saveSession(userId, session);
  res.json({ success: true, data: session });
});

router.post('/session/:userId/checkout', async (req, res) => {
  const { userId } = req.params;
  const { paymentMethod, paymentDetails, customerEmail } = req.body;
  
  console.log('[checkout] Checkout request received for userId:', userId);
  console.log('[checkout] Payment method:', paymentMethod);
  console.log('[checkout] Payment details:', paymentDetails);
  console.log('[checkout] Customer email:', customerEmail);
  
  const session = await getSession(userId);
  
  if (!session) {
    console.log('[checkout] No session found for userId:', userId);
    return res.status(400).json({ success: false, error: 'No checkout session found' });
  }
  
  if (session.items.length === 0) {
    console.log('[checkout] Session has no items');
    return res.status(400).json({ success: false, error: 'Cart is empty' });
  }
  
  if (!paymentMethod) {
    console.log('[checkout] No payment method provided');
    return res.status(400).json({ success: false, error: 'Payment method is required' });
  }
  
  // Validate shipping address is present
  if (!session.shippingAddress || !session.shippingAddress.name || !session.shippingAddress.email || !session.shippingAddress.address) {
    console.log('[checkout] Shipping address not set');
    return res.status(400).json({ success: false, error: 'Shipping address is required. Please fill in the shipping form.' });
  }
  
  const paymentResult = session.processPayment(paymentMethod, paymentDetails);
  if (!paymentResult.success) {
    console.log('[checkout] Payment failed:', paymentResult.error);
    return res.status(400).json({ success: false, error: paymentResult.error });
  }
  
  try {
    const order = await session.saveOrder();
    await deleteSession(userId);
    console.log('[checkout] Order created successfully:', order.orderId);
    res.json({ success: true, data: { order, transactionId: paymentResult.transactionId } });
  } catch (e) {
    console.error('[checkout] Order creation error:', e);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

router.get('/orders/:userId', async (req, res) => {
  try {
    const orders = await getOrdersByUserId(req.params.userId);
    res.json({ success: true, count: orders.length, data: orders });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

router.get('/order/:orderId', async (req, res) => {
  try {
    const order = await getOrderWithItems(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

module.exports = router;

