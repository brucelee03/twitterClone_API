const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDBServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is Running at http://localhost:3000')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}
initializeDBServer()

//AUTHENTICATION TOKEN
const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

//REGISTER THE USER API 1
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const createUserQuery = `INSERT INTO user(username, password, name, gender) VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}')`
      await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//LOGIN USER API 2
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//Get latest Tweets Whom user follows API 3
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const getTweetQuery = `
  SELECT 
    user.username AS username, tweet, date_time AS dateTime 
  FROM 
    tweet INNER JOIN user ON user.user_id = tweet.user_id 
  INNER JOIN 
    (SELECT 
      following_user_id 
    FROM 
      follower 
    WHERE 
      follower_user_id = (SELECT user_id FROM user WHERE username = '${username}')) 
  follower ON user.user_id = follower.following_user_id 
  ORDER BY date_time DESC 
  LIMIT 4;
  `
  const getTweet = await db.all(getTweetQuery)
  response.send(getTweet)
})

//GET USER FOLLOWING LIST API 4
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request
  //query1
  const getUserFollowingListQuery = `
  SELECT DISTINCT name
  FROM user
  INNER JOIN follower ON user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${username}');
  `
  const userFollowingList = await db.all(getUserFollowingListQuery)
  response.send(userFollowingList)
})

//GET USER FOLLOWERS LIST API 5
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request
  const getFollowersListQuery = `
  SELECT DISTINCT name
  FROM user
  INNER JOIN follower ON user.user_id = follower.follower_user_id
  WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username = '${username}');
  `
  const userFollowersList = await db.all(getFollowersListQuery)
  response.send(userFollowersList)
})

//GET TWEET OF USER FOLLOWING API 6
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const userId = await db.get(getUserIdQuery)

  const getTweetUserIdQuery = `SELECT user_id FROM tweet WHERE tweet_id = '${tweetId}'`
  const tweetUserId = await db.get(getTweetUserIdQuery)
  console.log(tweetUserId)

  const getuserFollowingArray = `SELECT following_user_id FROM follower WHERE follower_user_id = '${userId.user_id}'`
  const userFollowingArray = await db.all(getuserFollowingArray)
  const followingArray = userFollowingArray.map(id => id.following_user_id)
  console.log(followingArray)
  console.log(followingArray.includes(tweetUserId.user_id))

  if (followingArray.includes(tweetUserId.user_id)) {
    const getTweetQuery = `
    SELECT tweet, COUNT(like.user_id) AS likes, COUNT(reply.user_id) AS replies, date_time as dateTime
    FROM 
      tweet 
      INNER JOIN like ON like.tweet_id = tweet.tweet_id
      INNER JOIN reply ON like.tweet_id =  reply.tweet_id
    WHERE tweet.tweet_id = '${tweetId}'
    GROUP BY reply.user_id, like.user_id;
    `
    const getTweet = await db.get(getTweetQuery)
    response.send(getTweet)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

//GET USERNAME OF WHO LIKED THE TWEET API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
    const userId = await db.get(getUserIdQuery)

    const getTweetUserIdQuery = `SELECT user_id FROM tweet WHERE tweet_id = '${tweetId}'`
    const tweetUserId = await db.get(getTweetUserIdQuery)

    const getUserFollowingArray = `SELECT following_user_id FROM follower WHERE follower_user_id = '${userId.user_id}'`
    const userFollowingArray = await db.all(getUserFollowingArray)
    const followingArray = userFollowingArray.map(id => id.following_user_id)

    if (followingArray.includes(tweetUserId.user_id)) {
      const getUsernameQuery = `
    SELECT DISTINCT user.username
    FROM 
      user 
      INNER JOIN like ON like.user_id = user.user_id INNER JOIN tweet On like.tweet_id = tweet.tweet_id
    WHERE like.tweet_id = '${tweetId}'
    `
      const getUsername = await db.all(getUsernameQuery)
      const usernameList = getUsername.map(user => user.username)
      response.send({likes: usernameList})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

// GET NAME AND REPLY API 8
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
    const userId = await db.get(getUserIdQuery)

    const getTweetUserIdQuery = `SELECT user_id FROM tweet WHERE tweet_id = '${tweetId}'`
    const tweetUserId = await db.get(getTweetUserIdQuery)

    const getUserFollowingArray = `SELECT following_user_id FROM follower WHERE follower_user_id = '${userId.user_id}'`
    const userFollowingArray = await db.all(getUserFollowingArray)
    const followingArray = userFollowingArray.map(id => id.following_user_id)

    if (followingArray.includes(tweetUserId.user_id)) {
      const getNameAndReplyQuery = `
    SELECT DISTINCT name, reply.reply
    FROM 
      user 
      INNER JOIN reply ON reply.user_id = user.user_id INNER JOIN tweet On reply.tweet_id = tweet.tweet_id
    WHERE reply.tweet_id = '${tweetId}';
    `
      const getNameAndReply = await db.all(getNameAndReplyQuery)
      response.send({replies: getNameAndReply})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

//GET LIST OF ALL TWEET OF USER API 9
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const userId = await db.get(getUserIdQuery)

  const getUserTweetsQuery = `
  SELECT 
    tweet.tweet,  
    COUNT(DISTINCT reply.reply_id) AS replies, 
    COUNT(DISTINCT like.like_id) AS likes,
    tweet.date_time AS dateTime
  FROM 
    tweet
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE 
    tweet.user_id = '${userId.user_id}'
  GROUP BY 
    tweet.tweet_id;
  `
  const userTweets = await db.all(getUserTweetsQuery)
  response.send(userTweets)
})

//CREAT NEW TWEET API 10
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const {tweet} = request.body

  const getUserId = `SELECT user_id FROM user WHERE username = '${username}';`
  const userId = await db.get(getUserId)

  const getDate = new Date()
  let date = `${getDate.getUTCFullYear()}-${String(
    getDate.getUTCMonth() + 1,
  ).padStart(2, '0')}-${String(getDate.getUTCDate()).padStart(2, '0')} ${String(
    getDate.getUTCHours(),
  ).padStart(2, '0')}:${String(getDate.getUTCMinutes()).padStart(
    2,
    '0',
  )}:${String(getDate.getUTCSeconds()).padStart(2, '0')}`
  console.log(date)

  const createTweetQuery = `
  INSERT INTO
    tweet (tweet,user_id, date_time)
  VALUES
    ('${tweet}', '${userId.user_id}', '${date}');`
  const createTweet = await db.run(createTweetQuery)
  const tweetId = createTweet.lastID
  response.send('Created a Tweet')
})

//DELETE USER TWEET API 11
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params

    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
    const userIdResult = await db.get(getUserIdQuery)
    const userId = userIdResult.user_id
    console.log(userId)

    const getTweetOwnerQuery = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId};`
    const tweetOwnerResult = await db.get(getTweetOwnerQuery)
    const tweetOwnerId = tweetOwnerResult.user_id
    console.log(tweetOwnerId)

    if (userId !== tweetOwnerId) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`
      await db.run(deleteTweetQuery)

      response.send(`Tweet Removed`)
    }
  },
)

module.exports = app
