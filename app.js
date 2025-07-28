const express = require("express");
const mongodb = require("mongodb");
const cors = require("cors");
const dotenv= require("dotenv").config()
const app = express();
app.use(cors({origin:"*"}));
app.use(express.json());
const MongoClient =new  mongodb.MongoClient(process.env.MONGO);
mongodb.MongoClient.connect = async function() {
  return await MongoClient.connect(process.env.MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
};
const db= MongoClient.db("restaurant");
const users= db.collection("users");

app.get("/", (req, res) => {
  res.send("Hello World!");
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

app.post("/api/auth", async (req, res) => {
  const {email,password,username,new_user,google} = req.body;
  if (google){
    const user = await users.findOne({ email });
    if (user) {
      return res.status(200).json({ message: "Login Done",name:username});
    }
    await users.insertOne({ email, username });
    return res.status(201).json({ message: "Login Done",name:username});
  }
  if (new_user) {
    const existingUser = await users.findOne
({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists." });
    }
      await users.insertOne({ email, password, username })
      return res.status(201).json({ message: "User created successfully!" , name: username });
  }
  const user= await users.findOne({ email });
  if (user) {
    if (user.password === password) {
      res.status(200).json({ message: "Login successful!", name: user.username });
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

app.listen(5000, () => {
  console.log("Server is running on port 5000");
});