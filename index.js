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
async function run() {
  try {

    const db = client.db('velocity_garments');
    const productsCollection = db.collection('products');
    const usersCollection = db.collection('users');
    const ordersCollection = db.collection('orders');

    app.post('/products', async (req, res) => {
      const productsData = req.body;
      const result = await productsCollection.insertOne(productsData);
      res.send(result);
    })

    app.get('/products', async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    })

    app.get('/manage-products/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await productsCollection.find({ 'manager.email': email }).toArray();
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

    app.patch('/product/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedData = req.body;

      const updateDoc = {
        $set: {
          name: updatedData.name,
          category: updatedData.category,
          price: updatedData.price,
          quantity: updatedData.quantity,
          minOrder: updatedData.moq,
          showOnHome: updatedData.showOnHome,
          description: updatedData.description,
          images: updatedData.images,
        },
      };

      try {
        const result = await productsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update product" });
      }
    });

    //user
    app.post('/user', async (req, res) => {
      const userData = req.body;
      console.log(userData);

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

    app.get('/user/role', verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await usersCollection.findOne({ email })
      res.send({ role: result?.role })
    })

    app.post('/orders', async (req, res) => {
      const order = req.body;

      const query = { orderQuantity: order.orderQuantity };
      const existingOrder = await ordersCollection.findOne(query);

      if (existingOrder) {
        return res.status(409).send({ message: 'Order already exists.' });
      }
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });



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
