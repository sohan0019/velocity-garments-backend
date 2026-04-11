require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb')
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const { ObjectId } = require('mongodb');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)

//stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1];
  console.log('Token received:', token);
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log('Decoded token:', decoded);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    console.error('JWT error:', err);
    return res.status(401).send({ message: 'Unauthorized Access!', err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

//Creating random trackingId
const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

async function run() {
  try {

    const db = client.db('velocity_garments');
    const productsCollection = db.collection('products');
    const usersCollection = db.collection('users');
    const ordersCollection = db.collection('orders');
    const trackingsCollection = db.collection('trackings');

    //role middlewares
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== 'Admin') {
        return res.status(403).send({ message: 'Admin only Actions', role: user?.role })
      }
      next();
    }

    const verifyManager = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== 'Manager' && user?.role !== 'Admin') {
        return res.status(403).send({ message: 'Manager access required' });
      }
      next();
    };

    //tracking log function
    const logTracking = async (trackingId, status, location) => {
      const log = {
        trackingId,
        status,
        location,
        details: status.split('-').join(' '),
        createdAt: new Date(),
      }
      const result = await trackingsCollection.insertOne(log)
      return result;
    }


    //Products
    app.post('/products', verifyJWT, verifyManager, async (req, res) => {
      const productsData = req.body;
      if (productsData.quantity) productsData.quantity = Number(productsData.quantity);
      if (productsData.price) productsData.price = Number(productsData.price);
      if (productsData.moq) productsData.moq = Number(productsData.moq);
      const result = await productsCollection.insertOne(productsData);
      res.send(result);
    })

    app.get('/products', async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    })

    app.delete('/product/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });

    app.get('/product/:id', async (req, res) => {
      const id = req.params.id;
      const result = await productsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    })

    app.get('/homepage-products', async (req, res) => {
      try {
        const query = { showOnHome: true };
        const result = await productsCollection.find(query).sort({ _id: -1 }).limit(8).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching products", error });
      }
    })

    app.patch('/product/:id', verifyJWT, verifyManager, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedData = req.body;

      const updateDoc = {
        $set: updatedData,
      };

      try {
        const result = await productsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update product" });
      }
    });

    app.get('/manage-products/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await productsCollection.find({ 'manager.email': email }).toArray();
      res.send(result);
    })


    //user
    app.post('/user', async (req, res) => {
      const userData = req.body;
      // console.log(userData);

      userData.created_at = new Date().toISOString();
      userData.last_logged_in = new Date().toISOString();

      const query = { email: userData.email }

      const existingUser = await usersCollection.findOne(query);
      console.log('User Already Exists ----> ', !!existingUser);

      if (existingUser) {
        console.log('Updating User Info...........');
        const result = await usersCollection.updateOne(query,
          {
            $set: {
              last_logged_in: new Date().toISOString(),
            },
          })
        return res.send(result);
      }

      console.log('Saving new user info......');
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    })

    app.get('/user', verifyJWT, verifyAdmin, async (req, res) => {
      const adminEmail = req.tokenEmail;
      const result = await usersCollection.find({ email: { $ne: adminEmail } }).toArray();
      res.send(result);
    })

    app.get('/user/role', verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await usersCollection.findOne({ email })
      res.send({ role: result?.role })
    })

    app.get('/user/:email', async (req, res) => {
      const email = req.params.email

      const user = await usersCollection.findOne({ email })
      res.send(user)
    })


    //update users role
    app.patch('/update-status', verifyJWT, verifyAdmin, async (req, res) => {
      const { email, status, reason } = req.body;

      const result = await usersCollection.updateOne(
        { email },
        {
          $set: {
            status: status,
            reason: reason,
          }
        }
      );

      res.send(result);
    });


    //Orders
    app.post('/orders', async (req, res) => {
      try {
        const order = req.body;
        const trackingId = generateTrackingId();
        order.createdAt = new Date();
        order.trackingId = trackingId;
        order.orderStatus = 'pending';

        const { productId } = order;

        const orderQuantity = Number(order.orderQuantity);

        if (!productId || !ObjectId.isValid(productId)) {
          return res.status(400).send({ message: "Invalid productId" });
        }
        if (!orderQuantity || orderQuantity <= 0) {
          return res.status(400).send({ message: "Invalid order quantity" });
        }

        const currentProduct = await productsCollection.findOne({
          _id: new ObjectId(productId),
        });

        if (!currentProduct) {
          return res.status(404).send({ message: "Product not found" });
        }

        const availableStock = Number(currentProduct.quantity);

        if (isNaN(availableStock)) {
          return res.status(500).send({
            message: "Product stock is corrupted (not a number)",
          });
        }
        if (orderQuantity > availableStock) {
          return res.status(400).send({
            message: `Only ${availableStock} items available in stock`,
          });
        }

        await productsCollection.updateOne(
          { _id: new ObjectId(productId) },
          {
            $set: {
              quantity: availableStock - orderQuantity,
            },
          }
        );

        logTracking(trackingId, 'Order-created', 'Main Warehouse');

        const result = await ordersCollection.insertOne(order);

        res.send(result);

      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Something went wrong" });
      }
    });

    app.get('/orders', verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await ordersCollection.find({ buyerEmail: email }).toArray();
      res.send(result);
    })

    app.get('/orders/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;

      try {
        const result = await ordersCollection.aggregate([
          { $match: { _id: new ObjectId(id) } },
          {
            $addFields: {
              product_oid: { $toObjectId: "$productId" }
            }
          },
          {
            $lookup: {
              from: 'products',
              localField: 'product_oid',
              foreignField: '_id',
              as: 'productDetails'
            }
          },
          { $unwind: '$productDetails' },
          {
            $addFields: {
              productImage: { $arrayElemAt: ['$productDetails.images', 0] }
            }
          },
          {
            $project: {
              productDetails: 0,
              product_oid: 0
            }
          }
        ]).next();

        if (!result) return res.status(404).send({ message: "Order not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching order details", error });
      }
    });

    app.get('/all-orders', verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await ordersCollection.find().toArray();
      res.send(result);
    })

    app.delete('/orders/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    app.patch('/orders/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { status, trackingId } = req.body;
      console.log(status, trackingId);
      try {
        if (trackingId) {
          logTracking(trackingId, `Order-${status}`, 'Main Warehouse');
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { orderStatus: status },
        };

        const result = await ordersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Update failed", error });
      }
    });


    app.get('/pending-orders/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.find({ orderStatus: 'pending', managerEmail: email, }).toArray();
      res.send(result);
    })
    app.get('/approved-orders/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.aggregate([
        {
          $match: {
            orderStatus: 'approved',
            managerEmail: email,
          }
        },
        {
          $lookup: {
            from: 'trackings',
            localField: 'trackingId',
            foreignField: 'trackingId',
            as: 'trackingHistory'
          }
        },
        {
          $addFields: {
            latestTracking: { $arrayElemAt: ["$trackingHistory", -1] }
          }
        }
      ]).toArray();

      res.send(result);
    });

    app.post('/add-tracking', verifyJWT, async (req, res) => {
      const { trackingId, status, location } = req.body;

      try {
        if (!trackingId || !status || !location) {
          return res.status(400).send({ message: 'Missing required fields' });
        }
        const result = await logTracking(trackingId, status, location);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Failed to log tracking' });
      }
    });

    //Tracking APIs
    app.get('/trackings/:trackingId/logs', async (req, res) => {
      const trackingId = req.params.trackingId;
      const query = { trackingId };
      const result = await trackingsCollection.find(query).toArray();
      res.send(result);
    })

    app.get('/user-order-tracking/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const result = await ordersCollection.find({ buyerEmail: email }).toArray();
      res.send(result);
    });

    //payment from stripe
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);

      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: 'bdt',
            product_data: {
              name: paymentInfo?.name,
            },
            unit_amount: paymentInfo?.price * 100,
          },
          quantity: paymentInfo?.orderQuantity,
        }],
        customer_email: paymentInfo?.buyerEmail,
        mode: 'payment',
        metadata: {
          productId: paymentInfo?.productId,
          buyerEmail: paymentInfo?.buyerEmail,
          firstName: paymentInfo?.firstName,
          phone: paymentInfo?.phone,
          address: paymentInfo?.address,
          additionalNotes: paymentInfo?.additionalNotes || "",
          orderQuantity: paymentInfo?.orderQuantity.toString(),
        },
        success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/plant/${paymentInfo.productId}`,
      })
      res.send({ url: session.url })
    })

    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body;
      const trackingId = generateTrackingId();

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const existingOrder = await ordersCollection.findOne({ transactionId: session.payment_intent });
        if (existingOrder) {
          return res.send({
            transactionId: session.payment_intent,
            orderId: existingOrder._id,
          });
        }

        const product = await productsCollection.findOne({ _id: new ObjectId(session.metadata.productId) });

        if (session.payment_status === 'paid' && product) {
          const quantityPurchased = parseInt(session.metadata.orderQuantity);

          // 2. Prepare order info with EXACT keys from metadata
          const orderInfo = {
            buyerEmail: session.metadata.buyerEmail,
            name: product.name,
            price: product.price,
            paymentMethod: 'Stripe',
            firstName: session.metadata.firstName,
            orderQuantity: quantityPurchased,
            orderPrice: session.amount_total / 100,
            phone: session.metadata.phone,
            address: session.metadata.address,
            additionalNotes: session.metadata.additionalNotes,
            productId: session.metadata.productId,
            paymentStatus: 'paid',
            managerEmail: product.manager.email,
            createdAt: new Date(),
            transactionId: session.payment_intent,
            trackingId: trackingId,
            orderStatus: 'pending',
          };

          logTracking(trackingId, 'Order-created', 'Main Warehouse');
          // 3. Save order to DB
          const result = await ordersCollection.insertOne(orderInfo);

          // 4. Correctly decrement stock using productId (not plantId)
          await productsCollection.updateOne(
            { _id: new ObjectId(session.metadata.productId) },
            { $inc: { quantity: -quantityPurchased } }
          );

          return res.send({
            transactionId: session.payment_intent,
            orderId: result.insertedId,
          });
        }

        res.status(400).send({ message: "Payment not verified or product missing" });
      } catch (error) {
        console.error("Payment Success Error:", error);
        res.status(500).send({ message: "Internal Server Error", error: error.message });
      }
    });

    //statistics
    app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const productCount = await productsCollection.countDocuments();
        const orderCount = await ordersCollection.countDocuments();

        const managerCount = await usersCollection.countDocuments({ role: 'Manager' });
        const buyerCount = await usersCollection.countDocuments({ role: 'Buyer' });

        res.send({
          products: productCount,
          orders: orderCount,
          managers: managerCount,
          buyers: buyerCount
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch stats" });
      }
    });

    app.get('/manager-stats',verifyJWT, verifyManager, async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized: No email found" });
        }

        const totalProducts = await productsCollection.countDocuments({ "manager.email": email });
        const totalOrders = await ordersCollection.countDocuments({ managerEmail: email });
        const approvedOrders = await ordersCollection.countDocuments({
          managerEmail: email,
          orderStatus: 'approved'
        });
        const pendingOrders = await ordersCollection.countDocuments({
          managerEmail: email,
          orderStatus: 'pending'
        });

        res.send({
          totalProducts,
          totalOrders,
          approvedOrders,
          pendingOrders
        });

      } catch (error) {
        res.status(500).send({ message: "Failed to fetch stats" });
      }
    });

    app.get('/buyer-stats', async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized: No email found" });
        }
        const totalApprovedOrders = await ordersCollection.countDocuments({
          buyerEmail: email,
          orderStatus: 'approved',
        })
        const totalPendingOrders = await ordersCollection.countDocuments({
          buyerEmail: email,
          orderStatus: 'pending',
        })
        const totalRejectedOrders = await ordersCollection.countDocuments({
          buyerEmail: email,
          orderStatus: 'rejected',
        })
        const paidOrders = await ordersCollection.countDocuments({
          buyerEmail: email,
          paymentStatus: 'paid',
        })
        const codOrders = await ordersCollection.countDocuments({
          buyerEmail: email,
          paymentStatus: 'cod',
        })

        res.send({
          totalApprovedOrders,
          totalPendingOrders,
          totalRejectedOrders,
          paidOrders,
          codOrders,
        })
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch stats" });
      }
    })



    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
