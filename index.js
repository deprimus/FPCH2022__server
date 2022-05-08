import bodyParser from "body-parser";
import express from "express";
import forge from "node-forge";
import fs from "fs-extra";
import moment from "moment";
import uniqid from "uniqid";
import v8 from "v8";

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (error, promise) => {
  console.error("Unhandled Rejection at Promise", error, promise);
});

const INTERESTS = [
  "hiking",
  "reading",
  "fashion",
  "programming",
  "travel",
  "music",
  "soccer",
  "art",
  "running",
  "coffee",
  "pets",
  "tea",
  "gaming",
];

const LOCATIONS = ["Starbucks", "Releu", "Gradina Botanica", "Palas"];
const TIME_ADDED = 1000 * 60 * 60 * 24 * 7; //7 DAYS

const app = express();
app.use(express.static("./public"));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let DATABASE = {};
let MATCHING = {};

if (await fs.pathExists(`${process.cwd()}/storage/database.json`)) {
  DATABASE = await fs.readJSON(`${process.cwd()}/storage/database.json`);
}

DATABASE.match ??= [];
DATABASE.review ??= [];
DATABASE.user ??= [];

app.use((req, res, next) => {
  req.dbSync = async () => {
    fs.ensureDir(`${process.cwd()}/storage`);
    fs.writeJSON(`${process.cwd()}/storage/database.json`, DATABASE);
  };

  next();
});

app.post("/login", (req, res) => {
  for (let index = 0; index < DATABASE.user.length; index++) {
    if (
      DATABASE.user[index].password ===
        forge.md.sha512.create().update(req.body.password).digest().toHex() &&
      DATABASE.user[index].phone === req.body.phone
    ) {
      res.statusCode = 202;
      return res.json({
        data: dbGetUserById(DATABASE.user[index].id),
        status: 202,
      });
    }
  }

  res.statusCode = 422;
  res.json({ status: 422 });
});

function timestampFromNow(date) {
  return moment(date).calendar();
}

app.get("/db", async (req, res) => {
  res.json({ DATABASE, MATCHING });
});

app.post("/register", async (req, res) => {
  for (let index = 0; index < DATABASE.user.length; index++) {
    if (DATABASE.user[index].phone === req.body.phone) {
      res.statusCode = 422;
      return res.json({ status: 422 });
    }
  }

  const user = {
    id: uniqid(),
    avatar: JSON.parse(req.body.avatar),
    birthday_year: req.body.birthday_year,
    created_at: Date.now(),
    friends: [],
    gender: req.body.gender,
    interests: JSON.parse(req.body.interests),
    name: req.body.name,
    password: forge.md.sha512
      .create()
      .update(req.body.password)
      .digest()
      .toHex(),
    phone: req.body.phone,
  };

  DATABASE.user.push(user);
  await req.dbSync();

  res.statusCode = 201;
  res.json({ data: dbGetUserById(user.id), status: 201 });
});

app.get("/user/:id", (req, res) => {
  const user = dbGetUserById(req.params.id);

  if (user === null) {
    res.json({ status: 404 });
  }

  return res.json({ data: user, status: 200 });
});

app.use((req, res, next) => {
  for (let index = 0; index < DATABASE.user.length; index++) {
    if (DATABASE.user[index].id === req.headers.token) {
      req.user = dbGetUserById(DATABASE.user[index].id);
      return next();
    }
  }

  res.json({ status: 401 });
});

app.get("/interests", (req, res) => {
  res.json({ data: INTERESTS, status: 200 });
});

app.get("/me", (req, res) => {
  res.json({ data: req.user, status: 200 });
});

function dbGetUserById(id) {
  let user;

  for (let index = 0; index < DATABASE.user.length; index++) {
    if (DATABASE.user[index].id === id || DATABASE.user[index].phone === id) {
      user = v8.deserialize(v8.serialize(DATABASE.user[index]));
      break;
    }
  }

  if (!user) {
    return null;
  }

  user.rating = 0;
  let ratingNo = 0;

  for (let index = 0; index < DATABASE.review.length; index++) {
    if (DATABASE.review[index].friend_id === user.id) {
      user.rating += DATABASE.review[index].rating;
      ratingNo++;
    }
  }

  if (ratingNo > 0) user.rating /= ratingNo;
  user.rating = Math.ceil(user.rating);

  return user;
}

app.delete("/match", (req, res) => {
  if (MATCHING[req.body.interest] === req.user.id) {
    MATCHING[req.body.interest].sendCancel();
    delete MATCHING[req.body.interest];

    return res.json({ status: 202 });
  }

  res.json({ status: 422 });
});

function dbGetReview(friend_id, my_id) {
  for (let index = 0; index < DATABASE.review.length; index++) {
    if (
      DATABASE.review[index].friend_id === friend_id &&
      DATABASE.review[index].user_id === my_id
    ) {
      return DATABASE.review[index].rating;
    }
  }

  return null;
}

function dbMatchToTimeline(match_id, my_id) {
  for (let index = 0; index < DATABASE.match.length; index++) {
    if (DATABASE.match[index].id === match_id) {
      const data = v8.deserialize(v8.serialize(DATABASE.match[index]));

      let me, buddy;

      if (data.user1_id === my_id) {
        buddy = dbGetUserById(DATABASE.match[index].user2_id);
        me = dbGetUserById(DATABASE.match[index].user1_id);
      } else {
        buddy = dbGetUserById(DATABASE.match[index].user1_id);
        me = dbGetUserById(DATABASE.match[index].user2_id);
      }

      return {
        id: data.id,
        avatars: [me.avatar, buddy.avatar],
        created_at: timestampFromNow(data.start_date),
        location: data.location,
        rating: dbGetReview(buddy.id, me.id),
        title: buddy.name,
        type: "match",
        // rating: Math.ceil(Math.random() * 5),
      };
    }
  }

  return null;
}

app.get("/match", (req, res) => {
  for (let index = DATABASE.match.length - 1; index > -1; index--) {
    if (
      DATABASE.match[index].user1_id === req.user.id ||
      DATABASE.match[index].user2_id === req.user.id
    ) {
      return res.json({
        data: dbMatchToTimeline(DATABASE.match[index].id, req.user.id),
        status: 200,
      });
    }
  }

  res.json({ status: 404 });
});

app.get("/match/:id", (req, res) => {
  for (let index = DATABASE.match.length - 1; index > -1; index--) {
    if (DATABASE.match[index].id == req.params.id) {
      return res.json({
        data: dbMatchToTimeline(DATABASE.match[index].id, req.user.id),
        status: 200,
      });
    }
  }

  res.json({ status: 404 });
});

app.get("/friend_id", (req, res) => {
  for (let index = DATABASE.match.length - 1; index > -1; index--) {
    if (
      DATABASE.match[index].user1_id === req.user.id ||
      DATABASE.match[index].user2_id === req.user.id
    ) {
      return res.json({
        data:
          req.user.id === DATABASE.match[index].user1_id
            ? DATABASE.match[index].user2_id
            : DATABASE.match[index].user1_id,
        status: 200,
      });
    }
  }

  res.json({ status: 404 });
});

app.get("/timeline", (req, res) => {
  const timeline = [];

  for (let index = DATABASE.match.length - 1; index > -1; index--) {
    if (
      DATABASE.match[index].user1_id === req.user.id ||
      DATABASE.match[index].user2_id === req.user.id
    ) {
      timeline.push(dbMatchToTimeline(DATABASE.match[index].id, req.user.id));
    }
  }

  res.json({ data: timeline, status: 200 });
});

app.post("/match/review", async (req, res) => {
  let match;

  for (let index = DATABASE.match.length - 1; index > -1; index--) {
    if (
      DATABASE.match[index].user1_id === req.user.id ||
      DATABASE.match[index].user2_id === req.user.id
    ) {
      match = v8.deserialize(v8.serialize(DATABASE.match[index]));
      break;
    }
  }

  if (!match) {
    return res.json({ status: 404 });
  }

  let buddy_id;

  if (match.user1_id === req.user.id) {
    buddy_id = match.user2_id;
  } else {
    buddy_id = match.user1_id;
  }

  DATABASE.review.push({
    friend_id: buddy_id,
    rating: req.body.rating,
    user_id: req.user.id,
  });

  await req.dbSync();
  res.json({ status: 202 });
});

app.post("/match", async (req, res) => {
  if (MATCHING[req.body.interest] === undefined) {
    MATCHING[req.body.interest] = {
      sendCancel: () => {
        try {
          res.json({ status: 404 });
        } catch (e) {}
      },
      sendMatch: (match) => {
        try {
          res.json({ data: match, status: 201 });
        } catch (e) {}
      },
      userId: req.user.id,
    };
  } else {
    let match = v8.deserialize(
      v8.serialize({
        id: uniqid(),
        interest: req.body.interest,
        location: LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)],
        start_date: Date.now(),
        user1_id: req.user.id,
        user2_id: MATCHING[req.body.interest].userId,
      })
    );
    match.end_date = match.start_date + TIME_ADDED;

    DATABASE.match.push(match);
    match = v8.deserialize(v8.serialize(match));

    match.end_date = timestampFromNow(match.start_date + TIME_ADDED);
    match.start_date = timestampFromNow(match.start_date);

    match.user1 = dbGetUserById(req.user.id);
    match.user2 = dbGetUserById(MATCHING[req.body.interest].userId);

    await req.dbSync();
    MATCHING[req.body.interest].sendMatch(match);

    delete MATCHING[req.body.interest];
    res.json({ data: match, status: 201 });
  }
});

app.get("/friend", async (req, res) => {
  let friends = [];

  for (let index = 0; index < DATABASE.user.length; index++) {
    if (DATABASE.user[index].id === req.user.id) {
      friends = DATABASE.user[index].friends.map((f) => dbGetUserById(f));
      break;
    }
  }

  res.json({ data: friends, status: 200 });
});

app.post("/friend", async (req, res) => {
  for (let index = 0; index < DATABASE.user.length; index++) {
    if (DATABASE.user[index].id === req.user.id) {
      if (req.body.rating) {
        let match;

        for (let index = DATABASE.match.length - 1; index > -1; index--) {
          if (
            DATABASE.match[index].user1_id === req.user.id ||
            DATABASE.match[index].user2_id === req.user.id
          ) {
            match = v8.deserialize(v8.serialize(DATABASE.match[index]));
            break;
          }
        }

        if (!match) {
          return res.json({ status: 404 });
        }

        let buddy_id;

        if (match.user1_id === req.user.id) {
          buddy_id = match.user2_id;
        } else {
          buddy_id = match.user1_id;
        }

        DATABASE.review.push({
          friend_id: buddy_id,
          rating: +req.body.rating,
          user_id: req.user.id,
        });
      }

      DATABASE.user[index].friends.push(req.body.friend_id);

      await req.dbSync();
      return res.json({ status: 201 });
    }
  }

  res.json({ status: 422 });
});

app
  .listen(process.env.PORT || 80, "0.0.0.0", () =>
    console.log("Magic happends on port http://localhost:80")
  )
  .setTimeout(1000 * 60 * 5);
