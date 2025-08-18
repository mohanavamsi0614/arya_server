const express = require("express");
const mongodb = require("mongodb");
const cors = require("cors");
const dotenv= require("dotenv").config()
const app = express();
const socketio = require("socket.io");
const server=require("http").createServer(app);
const io =socketio(server, {cors:{origin:"*"}})
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
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
    reservationsCollection = db.collection("reservations");

    server.listen(5000, () => {
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
  const { products, data } = req.body;
  const { userId, additionalInfo, items, type, total, coins } = data;
  console.log(coins)
  const user = await usersCollection.findOne({ _id: new mongodb.ObjectId(userId) });
  const coinshaving = Number(user.coins) || 0;
  const coinsToUse = Number(coins) || 0;
  const orderTotal = Number(total) || 0;
  console.log(coinshaving)
  if (coinshaving < coinsToUse) {
    return res.status(400).json({ error: "Insufficient coins." });
  }
  let discount = 0;
  if (coinsToUse > 0)
    discount = coinsToUse;
  let finalTotal = orderTotal - discount;
  if (finalTotal < 0) finalTotal = 0;
  const earnedCoins = Math.floor(finalTotal / 10);
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
    let coupon = null;
    if (discount > 0) {
      coupon = await stripe.coupons.create({
        amount_off: Math.round(discount * 100),
        currency: "eur",
        name: `${coins} Coins Discount`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      discounts: coupon ? [{ coupon: coupon.id }] : [],
      success_url: "http://localhost:5173/success/{CHECKOUT_SESSION_ID}",
      cancel_url: "https://arya-pink-nine.vercel.app/cancel",
    });

    try {
      const ukDate = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });
      const ukTime = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const randStr = Math.floor(1000 + Math.random() * 9000);
      const orderId = `ARYA-${dateStr}-${timeStr}-${randStr}`;

      const newOrder = {
        userId,
        items,
        type,
        sessionId: session.id,
        status: "pending",
        payment: "pending",
        additionalInfo: additionalInfo,
        createdAt: ukDate,
        time: ukTime,
        table: additionalInfo.tableNumber || null,
        total: finalTotal,
        orderId: orderId,
        coinsUsed: coins,
        coinsEarned: earnedCoins,
      };
      console.log("New order created:", newOrder);

      await orderCollection.insertOne(newOrder);
    } catch (error) {
      console.error("Error creating order:", error);
      return res.status(500).json({ error: "Internal server error." });
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
  const {coinsEarned,coinsUsed} = order;
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

  const now = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const randStr = Math.floor(1000 + Math.random() * 9000);
  const orderId = `ARYA-${dateStr}-${timeStr}-${randStr}`;
  const ukDate = now.toLocaleString("en-GB", { timeZone: "Europe/London" });
  const ukTime = now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: '2-digit', minute: '2-digit', second: '2-digit' });
  await orderCollection.updateOne(
    { sessionId },
    { $set: { payment: "paid", orderId: orderId, createdAt: ukDate, time: ukTime } }
  );
  await transporter.sendMail({to:user.email,from:process.env.MAIL,subject:"Order Confirmation",html:`<!DOCTYPE html>
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

user.cartItems = [];
const safeCoinsUsed = Number(coinsUsed) || 0;
const safeCoinsEarned = Number(coinsEarned) || 0;
const safeUserCoins = Number(user.coins) || 0;
const newCoinBalance = (safeUserCoins - safeCoinsUsed) + safeCoinsEarned;
console.log("Updating user coins:", user._id, newCoinBalance);
await usersCollection.updateOne(
  { _id: user._id },
  { $set: { cartItems: [], coins: newCoinBalance } }
);
console.log("Updated user coins:", user._id, newCoinBalance);
res.json({ "Payment successful": true, coins: newCoinBalance });
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

app.get("/coins/:userid",async(req,res)=>{
  const {userid}=req.params
  const user=await usersCollection.findOne({ _id: new mongodb.ObjectId(userid) });
  if(user){
    return res.status(200).json({ coins: user.coins });
  }
  return res.status(404).json({ error: "User not found." });
});

app.post("/api/auth", async (req, res) => {
  const {email,password,username,new_user,google} = req.body;
  console.log(req.body)
  const user = await usersCollection.findOne({ email });
  if (new_user) {
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists." });
    }
  const user = await usersCollection.insertOne({ email, password, username, cartItems: [], coins: 0 });
    console.log("New user created:", user);
    return res.status(201).json({ message: "Login Done!" , userId: user.insertedId ,email,username,cartItems:[],coins:0 });
  }
  if (google){
    if (user) {
      return res.status(200).json({ message: "Login Done", userId: user._id ,email,username: user.username,cartItems: user.cartItems ? user.cartItems : [],coins: user.coins || 0 });
    }
  await usersCollection.insertOne({ email, username, cartItems: [], coins: 0 });
    return res.status(201).json({ message: "Login Done", userId: user._id ,email,username: user.username,cartItems: user.cartItems ? user.cartItems : [],coins: 0 });
  }
  if (user) {
    if (user.password === password) {
      res.status(200).json({ message: "Login successful!", userId: user._id ,email,username: user.username,cartItems: user.cartItems ? user.cartItems : [],coins: user.coins || 0 });
    } else {
      res.status(401).json({ error: "Invalid password." });
    }
  }
})
app.post("/api/cart",async(req,res)=>{
  const { userId, items } = req.body;
  console.log(items)
  if (!userId) {
    return res.status(400).json({ error: "Invalid cart data." });
  }

  try {
    const userIdObj = new mongodb.ObjectId(userId);
    await usersCollection.updateOne({ _id: userIdObj }, { $set: { cartItems: items } });
    res.status(200).json({ message: "Cart updated successfully!" });
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).json({ error: "Internal server error." });
  }
})
app.get('/api/check' ,async (req , res)=>{
  const orders=await orderCollection.find({status:"pending"}).toArray();
  if(orders){
    console.log("Pending orders found:", orders);
    orders.forEach(async (element)=>{
      await transporter.sendMail({to:"mohanavamsi14@gmail.com",from:process.env.MAIL,subject:"Pending Orders",html:
      `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pending Order Reminder</title>
</head>
<body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f6f6f6; color: #333;">
  <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #eee;">
    
    <div style="background-color: #c0392b; color: #fff; padding: 20px; text-align: center;">
      <h2 style="margin: 0; font-size: 22px;">⚠ Action Required – Order #${element.orderId} Pending</h2>
    </div>

    <div style="padding: 20px;">
      <p style="font-size: 15px; margin-bottom: 12px;">Hello <strong>Staff</strong>,</p>

      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 12px;">
        An order has been awaiting acceptance for over <strong>5 minutes</strong> on the Arya Asian staff dashboard.
        Please review and accept it immediately to avoid delays in service.
      </p>

      <h3 style="margin: 15px 0 8px;">Order Details</h3>
      <ul style="padding-left: 18px; margin: 0 0 12px;">
        <li><strong>Customer:</strong> ${element.additionalInfo.fullName}</li>
        <li><strong>Order Time:</strong> ${element.time}</li>
      </ul>

      <h4 style="margin: 15px 0 8px;">Items:</h4>
      <ul style="padding-left: 18px; margin: 0;">
        ${element.items.map(i => `
          <li style="margin-bottom: 8px; font-size: 15px;">
            <img src="${i.image}" alt="${i.name}" style="width:50px; height:50px; object-fit:cover; vertical-align: middle; border-radius: 4px; margin-right: 8px;">
            ${i.name} – ${i.quantity}
          </li>
        `).join('')}
      </ul>

      <p style="margin-top: 15px;">
        <a href="" style="display: inline-block; padding: 10px 16px; background-color: #c0392b; color: #fff; text-decoration: none; border-radius: 4px;">Open Dashboard</a>
      </p>
    </div>

    <div style="font-size: 13px; color: #777; text-align: center; padding: 15px; border-top: 1px solid #eee;">
      — Arya Asian Management Team
    </div>

  </div>
</body>
</html>
      `})
    })
    
    return res.json("Check completed");
  }
  else{
    return res.status(404).json({ error: "No pending orders found." });
  }
})  
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

function toMinutes(timeStr) {
  console.log(timeStr)
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

async function isAvailable(date, startTime, endTime, table) {
  const reservations = await reservationsCollection.find({ date, table,status:"accepted" }).toArray();

  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);

  for (let r of reservations) {
    const existingStart = toMinutes(r.startTime);
    const existingEnd = toMinutes(r.endTime);

    if (newStart < existingEnd && newEnd > existingStart) {
      return false;
    }
  }

  return true; 
}

app.post("/api/reservation",async (req,res)=>{
  const {name,email,phone,table,date,startTime,endTime,userId} = req.body;
  if(!name || !email || !phone || !table || !date || !startTime || !endTime){
    return res.status(400).json({error:"All fields are required"});
  }
  if (await isAvailable(date, startTime, endTime, table)) {
    reservationsCollection.insertOne({name,email,phone,table,date,startTime,endTime,userId,status:"pending"})
      .then(() => {
        res.status(201).json({message:"Reservation created successfully!"});
      })
      .catch((error) => {
        console.error("Error creating reservation:", error);
        res.status(500).json({error:"Internal server error."});
      });
  }
  else{
    res.status(409).json({error:"Reservation time is not available."});
  }

})
app.get("/api/reservations/:date",async (req,res)=>{
  const {date} = req.params;
  if(!date){
    return res.status(400).json({error:"Date is required"});
  }
  const reservations = await reservationsCollection.find({date}).toArray();
  res.status(200).json(reservations);
})

app.get("/api/reservations/:userid",async (req,res)=>{
  const {userid} = req.params;
  if(!userid){
    return res.status(400).json({error:"User ID is required"});
  }
  const reservations = await reservationsCollection.find({userid}).toArray();
  res.status(200).json(reservations);
})

app.post("/api/reservations/:id",async (req,res)=>{ 
  const {id}=req.params
  const {status}=req.body
  await reservationsCollection.updateOne({_id:new mongodb.ObjectId(id)},{$set:{status}})
  res.status(200).json({message:"Reservation status updated successfully!"})
})