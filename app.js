const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//1. Post Register User

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
        INSERT INTO 
            user (username, name, password, gender) 
        VALUES 
            (
            '${username}', 
            '${name}',
            '${hashedPassword}', 
            '${gender}'
            )`;
      const dbResponse = await db.run(createUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//2. Post Login API

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "badal");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Authentication Function

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "badal", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        loggedInQuery = `
        SELECT
            *
        FROM 
            user
        WHERE
            username = '${payload.username}';`;

        queryResponse = await db.get(loggedInQuery);
        const { user_id, name, username, password, gender } = queryResponse;

        request.user_id = user_id;
        request.name = name;
        request.username = username;
        request.gender = gender;
        next();
      }
    });
  }
};

// 3. Get Latest User Tweets /user/tweets/feed/

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const getTweetsQuery = `
    SELECT
        username, tweet, date_time AS dateTime
    FROM
        user
    NATURAL JOIN 
        tweet
    INNER JOIN
        follower
    ON follower.following_user_id = tweet.user_id
    
    WHERE
        follower.follower_user_id = ${request.user_id}
    ORDER BY 
        tweet.date_time DESC
    LIMIT 
        4
    ;`;
  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

// 4. Get Names of People Whom User Follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const getFollowingNamesQuery = `
    SELECT
        name
    FROM
        user
    INNER JOIN
    follower
    ON follower.following_user_id = user.user_id
    WHERE
        follower.follower_user_id = ${request.user_id}
    ;`;
  const namesArray = await db.all(getFollowingNamesQuery);
  response.send(namesArray);
});

// 5. Get Names of People Who Follow User

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const getFollowerNamesQuery = `
    SELECT
        name
    FROM
        user
    INNER JOIN
    follower
    ON follower.follower_user_id = user.user_id
    WHERE
        follower.following_user_id = ${request.user_id}
    ;`;
  const namesArray = await db.all(getFollowerNamesQuery);
  response.send(namesArray);
});

//Is User Follows Validation

const isUserFollows = async (request, response, next) => {
  const { tweetId } = request.params;
  tweetQuery = `
    SELECT
    *
    FROM
        tweet
    INNER JOIN 
        follower
    ON follower.following_user_Id = tweet.user_id
    WHERE
        tweet.tweet_id = ${tweetId} 
    AND
        follower.follower_user_Id = ${request.user_id}
    ;`;
  tweetQueryResponse = await db.get(tweetQuery);
  if (tweetQueryResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//6. Get Tweet Details BY Tweet Id API

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  isUserFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT
        tweet, 
        SUM(like_id) AS likes, 
        SUM(reply_id) AS replies,
        tweet.date_time AS dateTime
    FROM
        tweet
    INNER JOIN
        reply
    ON reply.tweet_id = tweet.tweet_id
    INNER JOIN
        like
    ON like.tweet_id = tweet.tweet_id
    WHERE
        tweet.tweet_id = ${tweetId};`;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

//7. Get Tweet Likes Details BY Tweet Id API

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isUserFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
    SELECT
        username
    FROM
        user
    NATURAL JOIN
        tweet
    INNER JOIN
        like
    ON like.tweet_id = tweet.tweet_id
    WHERE
        like.tweet_id = ${tweetId};`;
    const likes = await db.all(getLikesQuery);
    response.send(likes.map((each) => each.username));
  }
);

//8. Get Tweet Replies Details BY Tweet Id API

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isUserFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `
    SELECT
        name, reply
    FROM
        reply
    NATURAL JOIN
        user
    WHERE
        reply.tweet_id = ${tweetId};`;
    const replies = await db.all(getRepliesQuery);
    response.send({ replies });
  }
);

//9. Get All Tweets User API

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const getTweetsQuery = `
    SELECT
        tweet, 
        likes, 
        replies,
        tweet.date_time AS dateTime
    FROM
        tweet
    INNER JOIN
        reply
    ON reply.tweet_id = tweet.tweet_id
    INNER JOIN
        like
    ON like.tweet_id = reply.tweet_id
    WHERE
        tweet.user_id = ${request.user_id};`;
  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

//10. Post Tweet

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const postTweetQuery = `
    INSERT INTO
      tweet (tweet, user_id)
     VALUES
      (
       '${tweet}', ${request.user_id}
      );`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//has tweet and userId Function
const hasTweetOfUser = async (request, response, next) => {
  const { tweetId } = request.params;
  const hasTweetQuery = `
    SELECT
    *
    FROM
        tweet
    WHERE
        user_id = ${request.user_id}
    AND
        tweet_id = ${tweetId};`;
  const hasTweetQueryResponse = await db.get(hasTweetQuery);
  console.log(hasTweetQueryResponse);
  if (hasTweetQueryResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//11. Delete Tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  hasTweetOfUser,
  async (request, response) => {
    const { tweetId } = request.params;

    const deleteTweetQuery = `
    DELETE
    FROM
        tweet
    WHERE
        tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
