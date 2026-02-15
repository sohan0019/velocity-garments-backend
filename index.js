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
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_URL],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

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
    app.post('/products', async (req, res) => {
      const productsData = req.body;
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
        const result = await productsCollection.find(query).limit(8).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching products", error });
      }
    })

    app.patch('/product/:id', verifyJWT, async (req, res) => {
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
      const { email, status } = req.body;
      const result = await usersCollection.updateOne({ email }, { $set: { status } });
      res.send(result);
    })


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


    app.get('/pending-orders', verifyJWT, async (req, res) => {
      const result = await ordersCollection.find({ orderStatus: 'pending' }).toArray();
      res.send(result);
    })
    app.get('/approved-orders', verifyJWT, async (req, res) => {
      const result = await ordersCollection.aggregate([
        { $match: { orderStatus: 'approved' } }, // Filter only approved orders
        {
          $lookup: {
            from: 'trackings',           // The collection to join with
            localField: 'trackingId',    // Field from ordersCollection
            foreignField: 'trackingId',  // Field from trackings collection
            as: 'trackingHistory'        // Name for the new array field
          }
        },
        {
          $addFields: {
            // Get the latest tracking entry by looking at the last item in the array
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
