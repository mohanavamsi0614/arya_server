const axios = require("axios");
const fs = require("fs");
const dotenv = require("dotenv").config();

const data=JSON.parse(fs.readFileSync("menu.json","utf-8"));

// console.log(data)

const mongodb = require("mongodb");
const MongoClient = new mongodb.MongoClient("mongodb+srv://mohanavamsi14:vamsi@cluster0.mug2zd1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
let menuCollection
MongoClient.connect()
  .then((client) => {
    db = client.db("restaurant");
    menuCollection = db.collection("menu");
    for (let file of data) {
    addImage(file, file.image);
    console.log("Added item:", file.name);
}

  });

function addImage(item,path) {
    const FormData = require("form-data");
    const formData = new FormData();
    let img;
    console.log(path)
    formData.append("file", fs.createReadStream(path));
    formData.append("upload_preset", "aryamenu");

    axios.post(
        "https://api.cloudinary.com/v1_1/dhkfdkkmf/image/upload",
        formData,
        { headers: formData.getHeaders() }
    )
    .then(response => {
        img = response.data.secure_url;
        console.log(img)
        console.log("Image uploaded successfully:", img);
        menuCollection.insertOne({...item, image: img});
    })
    .catch(error => {
        console.log("not founf giving defualt")

    });

    return "done"
}