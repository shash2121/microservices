const express = require('express');
const router = express.Router();
const { CheckoutSession, CheckoutItem } = require('../models/Checkout');
const { getOrdersByUserId, getOrderWithItems } = require('../config/database');
// const EmailService = require('../services/EmailService'); // removed as not used
const { cache } = require('../config/redis');

const SESSION_TTL = 1800;

// const emailService = new EmailService(); // removed as EmailService not used

// These endpoints are now handled by landing-service for persistence.
// We keep them as proxies or remove them to avoid confusion.
// For now, we'll remove the cache-based implementation to use the persistent one in landing-service.


function createSession(userId, data = null) {
  const session = new CheckoutSession(userId);
  if (data) {
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
      session.items = data.items.map(item => {
        const checkoutItem = new CheckoutItem(
          item.productId,
          item.name,
          item.price,
          item.image,
          item.quantity
        );
        checkoutItem.id = item.id;
        return checkoutItem;
      });
    }
  }
  return session;
}

async function getSession(userId) {
  const cached = await cache.get(`checkout:${userId}`);
  if (cached) {
    return createSession(userId, cached);
  }
  return null;
}

async function saveSession(userId, session) {
  console.log('[checkout] Saving session to Redis key', `checkout:${userId}`);
  const result = await cache.set(`checkout:${userId}`, {
    id: session.id,
    userId: session.userId,
    items: session.items.map(item => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      price: item.price,
      image: item.image,
      quantity: item.quantity
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
  console.log('[checkout] Redis set result:', result);
}

async function deleteSession(userId) {
  await cache.del(`checkout:${userId}`);
}

router.get('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  const session = await getSession(userId);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'No checkout session found'
    });
  }

  res.json({
    success: true,
    data: {
      id: session.id,
      userId: session.userId,
      items: session.items,
      subtotal: session.subtotal,
      discount: session.discount,
      discountCode: session.discountCode,
      tax: session.tax,
      shippingCost: session.shippingCost,
      total: session.total,
      status: session.status,
      shippingAddress: session.shippingAddress
    }
  });
});

router.post('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  const { items, addressId } = req.body;

  console.log('Creating checkout session for userId:', userId);

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Cart items are required' });
  }

  const session = new CheckoutSession(userId);

  items.forEach(item => {
    session.addItem({
      id: item.productId,
      name: item.name,
      price: item.price,
      image: item.image
    }, item.quantity);
  });

  // If addressId provided, fetch saved address
  // Note: In a real microservices env, this would be a call to landing-service.
  // For this implementation, the frontend will fetch the address from landing-service
  // and pass the full address object to 'set_shipping' or the session creation.
  if (addressId) {
    // This part is now redundant if the frontend sends the full address.
    // But we can keep a placeholder or remove it.
  }

  await saveSession(userId, session);

  console.log('Checkout session created:', session.id);
  res.json({
    success: true,
    message: 'Checkout session created',
    data: {
      id: session.id,
      userId: session.userId,
      items: session.items,
      subtotal: session.subtotal,
      discount: session.discount,
      tax: session.tax,
      shippingCost: session.shippingCost,
      total: session.total,
      status: session.status,
      shippingAddress: session.shippingAddress
    }
  });
});

router.put('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  const { action, itemId, product, quantity, discountCode, shippingAddress } = req.body;

  let session = await getSession(userId);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Checkout session not found'
    });
  }

  switch (action) {
    case 'add_item':
      session.addItem(product, quantity);
      break;

    case 'remove_item':
      session.removeItem(itemId);
      break;

    case 'update_quantity':
      session.updateItemQuantity(itemId, quantity);
      break;

    case 'apply_discount':
      const result = session.applyDiscount(discountCode);
      if (!result.success) {
        return res.status(400).json(result);
      }
      break;

    case 'set_shipping':
      session.calculateShipping(shippingAddress);
      break;

    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid action'
      });
  }

  await saveSession(userId, session);

  res.json({
    success: true,
    message: 'Checkout session updated',
    data: {
      ...session,
      subtotal: session.subtotal,
      taxableAmount: session.subtotal,
      tax: session.tax,
      total: session.total
    }
  });
});

router.post('/session/:userId/checkout', async (req, res) => {
  const { userId } = req.params;
  const { paymentMethod, paymentDetails, customerEmail } = req.body;

  console.log('Processing checkout for userId:', userId);

  let session = await getSession(userId);

  if (!session || session.items.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'No checkout session found or cart is empty'
    });
  }

  const paymentResult = session.processPayment(paymentMethod, paymentDetails);

  if (!paymentResult.success) {
    return res.status(400).json({
      success: false,
      error: paymentResult.error
    });
  }

  try {
    const order = await session.saveOrder();
    await deleteSession(userId);

    // if (customerEmail) {
    //   await emailService.sendOrderConfirmation(order, customerEmail);
    // }

    console.log('Order created:', order.orderId);

    res.json({
      success: true,
      message: 'Order placed successfully',
      data: {
        order: order,
        transactionId: paymentResult.transactionId
      }
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create order',
      details: error.message
    });
  }
});

router.get('/order/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  try {
    const order = await getOrderWithItems(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order'
    });
  }
});

router.get('/orders/:userId', async (req, res) => {
  const { userId } = req.params;

  console.log('Fetching orders for userId:', userId);

  try {
    const userOrders = await getOrdersByUserId(userId);

    console.log('Orders found:', userOrders.length, userOrders);

    res.json({
      success: true,
      count: userOrders.length,
      data: userOrders
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
});

router.get('/orders/debug', async (req, res) => {
  const { getPool, isConnected } = require('../config/database');

  try {
    if (isConnected()) {
      const pool = getPool();
      const [rows] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
      res.json({
        success: true,
        dbConnected: true,
        count: rows.length,
        data: rows
      });
    } else {
      const { orders } = require('../config/database');
      const allOrders = Array.from(orders.values());
      res.json({
        success: true,
        dbConnected: false,
        count: allOrders.length,
        data: allOrders
      });
    }
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/discount-codes', (req, res) => {
  res.json({
    success: true,
    data: [
      { code: 'WELCOME10', description: '10% off on your order', type: 'percentage', value: 10 },
      { code: 'SAVE20', description: '20% off on orders above ₹5000', type: 'percentage', value: 20, minOrder: 5000 },
      { code: 'FLAT500', description: 'Flat ₹500 off on orders above ₹3000', type: 'flat', value: 500, minOrder: 3000 }
    ]
  });
});

module.exports = router;
