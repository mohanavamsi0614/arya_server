const express = require("express");
const mongodb = require("mongodb");
const cors = require("cors");
const { Socket } = require("socket.io");
const dotenv= require("dotenv").config()
const app = express();
const socketio = require("socket.io");
const server=require("http").createServer(app);
const io =socketio(server, {cors:{origin:"*"}})
const nodemailer = require("nodemailer");
const transpoter= nodemailer.createTransport({
  service:"gmail",
  auth:{
    user: process.env.MAIL,
    pass: process.env.PASS
  }
})
const stripe = require("stripe")(process.env.stripe);


app.use(cors({origin:"*"}));
app.use(express.json());
const MongoClient = new mongodb.MongoClient(process.env.MONGO, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});


let db, usersCollection, orderCollection,menuCollection;
const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
MongoClient.connect()
  .then((client) => {
    db = client.db("restaurant");
    usersCollection = db.collection("users");
    orderCollection = db.collection("orders");
    menuCollection = db.collection("menu");

    // ✅ Start the server only after DB connects
    app.listen(5000, () => {
      console.log("Server running on port 5000");
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Stop server if DB fails
  });
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/api/menu", async (req, res) => {
  try {
    const menuItems = await menuCollection.find().toArray();
    res.status(200).json(menuItems);
  } catch (error) {
    console.error("Error fetching menu:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/api/menu", async (req, res) => {
  const {item}=req.body;
  console.log(item)
  try {
    await menuCollection.insertOne(item);
    res.status(201).json({ message: "Menu item added successfully!" });
  } catch (error) {
    console.error("Error adding menu item:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/api/menu/:id", async (req, res) => {
  const {id}=req.params;
  const {item}=req.body;
  try {
    await menuCollection.updateOne({ _id: new mongodb.ObjectId(id) }, { $set: item });
    res.status(200).json({ message: "Menu item updated successfully!" });
  } catch (error) {
    console.error("Error updating menu item:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.delete("/api/menu/:id", async (req, res) => {
  const {id}=req.params;
  try {
    await menuCollection.deleteOne({ _id: new mongodb.ObjectId(id) });
    res.status(200).json({ message: "Menu item deleted successfully!" });
  } catch (error) {
    console.error("Error deleting menu item:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/api/reservations", async (req, res) => {
  try {
    const client = await MongoClient.connect();
    const db = client.db("restaurant");
    const reservations = await db.collection("reservations").find().toArray();
    client.close();
    res.status(200).json(reservations);
  } catch (error) {
    console.error("Error fetching reservations:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const client = await MongoClient.connect();
    const db = client.db("restaurant");
    const users = await db.collection("users").find().toArray();
    client.close();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const orders = await orderCollection.find().toArray();
    console.log(orders)
    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  const {id} = req.params
  console.log(id)
  const orders=await orderCollection.find({userId:id}).toArray();
  console.log(orders)
  res.status(200).json(orders);
})

app.post("/api/create-checkout-session", async (req, res) => {
  const { products,data } = req.body;
  console.log(data)
  const { userId, additionalInfo, items,type,total } = data;

  const line_items = products.map((item) => ({
    price_data: {
      currency: "eur",
      product_data: {
        name: item.name,
        images: [item.image],
        description: item.description || "No description",
      },
      unit_amount: Math.round(item.price * 100),
    },
    quantity: item.quantity,
  }));

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: "http://localhost:5173/success/{CHECKOUT_SESSION_ID}",
      cancel_url: "https://arya-pink-nine.vercel.app/cancel",
    });
      try {
    const newOrder = {
      userId,
      items,
      type,
      sessionId:session.id,
      status: "pending",
      payment:"pending",
      additionalInfo: additionalInfo,
      createdAt:days[new Date().getDay()] + " "+ new Date().getDate()+"/"+(new Date().getMonth()+1)+"/"+new Date().getFullYear(),
      time: new Date().getHours()+":"+new Date().getMinutes(),
      table:additionalInfo.tableNumber || null,
      total:total,
    };

    await orderCollection.insertOne(newOrder);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Internal server error." });
  }

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

app.post("/api/order/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  console.log("Creating order for session:", req.body);
  const order=await orderCollection.findOne({ sessionId })
  if(order.payment === "paid"){
    res.json("Order already paid");
    }
  
  const check=await stripe.checkout.sessions.retrieve(sessionId)
  console.log("Payment status:", check);
  if (check.payment_status != "paid"){
    res.json("payment not successful")
    return
  }
  console.log("User ID from order:", order.userId);
  const user = await usersCollection.findOne({ _id: new mongodb.ObjectId(order.userId) });
console.log(user)
  await orderCollection.updateOne({ sessionId }, { $set: { payment: "paid", orderId: "Arya" + new Date().getHours()+ new Date().getMinutes()+ new Date().getSeconds() } });
  await transpoter.sendMail({to:user.email,from:process.env.MAIL,subject:"Order Confirmation",html:`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Order Confirmation</title>
  <style>
    body { font-family: Arial, sans-serif; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: auto; padding: 20px; background-color: #fff; }
    h2 { color: #d35400; }
    p { font-size: 16px; line-height: 1.5; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    .footer { margin-top: 20px; font-size: 14px; color: #777; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Your Arya Asian Order is Confirmed!</h2>
    <p>Hi <strong>${user.username}</strong>,</p>

    <p>Thank you for ordering from <strong>Arya Asian Restaurant</strong>!  
    Your order <strong>#${order.orderId}</strong> has been successfully placed and paid.</p>

    <h3>Order Details:</h3>
    <ul>
      <li><strong>Items:</strong>
        <ul>
          ${order.items.map(item => `<li>
          <img src="${item.image}" alt="${item.name}" style="width: 100px; height: auto;">
          ${item.name} - £${item.price}</li>`).join("")}
        </ul>
      </li>
      <li><strong>Total Amount:</strong> £${order.total}</li>
      <li><strong>Order Time:</strong> ${order.createdAt} ${order.time}</li>
      <li><strong>Delivery/Pickup:</strong> ${order.deliveryMode}</li>
    </ul>

    <p>We’ll start preparing your food right away so it reaches you fresh and delicious.<br>
    You can track your order status anytime here: <a href="[Order Tracking Link]">Track Order</a></p>

    <p>If you have any questions, feel free to call us at <strong>[Phone Number]</strong>.</p>

    <p class="footer"><strong>Arya Asian Restaurant</strong> – Bringing authentic Asian flavors to your table.</p>
  </div>
</body>
</html>`})
  
  res.json("Payment successful");
});
app.post("/api/order-status", async (req, res) => {
  const { orderId, status } = req.body;
  console.log(orderId,status)
  if (!orderId || !status) {
    return res.status(400).json({ error: "Invalid order status data." });
  }

  try {
    const orderIdObj = new mongodb.ObjectId(orderId);
    await orderCollection.updateOne({ _id: orderIdObj }, { $set: { status } });
    res.status(200).json({ message: "Order status updated successfully!" });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/api/auth", async (req, res) => {
  const {email,password,username,new_user,google} = req.body;
  if (google){
    const user = await usersCollection.findOne({ email });
    if (user) {
      return res.status(200).json({ message: "Login Done", userId: user._id ,email,username: user.username });
    }
    await usersCollection.insertOne({ email, username });
    return res.status(201).json({ message: "Login Done", userId: user._id ,email,username: user.username });
  }
  if (new_user) {
    const existingUser = await usersCollection.findOne
({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists." });
    }
      await usersCollection.insertOne({ email, password, username })
      return res.status(201).json({ message: "User created successfully!" , userId: user._id ,email,username :user.username });
  }
  const user= await usersCollection.findOne({ email });
  if (user) {
    if (user.password === password) {
      res.status(200).json({ message: "Login successful!", userId: user._id ,email,username: user.username });
    } else {
      res.status(401).json({ error: "Invalid password." });
    }
  }
})

app.post("/api/reservation", async (req, res) => {
  const { name, phone, email, guests, date, time } = req.body;
  if (!name || !phone || !email || !guests || !date || !time) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const client = await MongoClient.connect();
    const db = client.db("restaurant");
    const collection = db.collection("reservations");

    const newReservation = {
      name,
      phone,
      email,
      guests,
      date,
      time,
      createdAt: new Date()
    };

    await collection.insertOne(newReservation);
    client.close();

    res.status(201).json({ message: "Reservation created successfully!" });
  } catch (error) {
    console.error("Error creating reservation:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  socket.on("order",async ()=>{
    const orders = await orderCollection.find({}).toArray();
    console.log("Current orders:", orders);
    io.emit("new-order", orders);
  })
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});
server.listen(5000, () => {
  console.log("Server is running on port 5000");
});