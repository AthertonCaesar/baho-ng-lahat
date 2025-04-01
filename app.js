// app.js - Complete Overhaul

require('dotenv').config();
const express       = require('express');
const mongoose      = require('mongoose');
const bcrypt        = require('bcryptjs');
const session       = require('express-session');
const fileUpload    = require('express-fileupload');
const path          = require('path');
const fs            = require('fs');
const helmet        = require('helmet');
const morgan        = require('morgan');
const rateLimit     = require('express-rate-limit');
const http          = require('http');
const socketIO      = require('socket.io');

// For video thumbnail generation (via Cloudinary transformation)
const ffmpeg        = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Cloudinary config
const cloudinary    = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'yourCloudName',
  api_key: process.env.CLOUDINARY_API_KEY || 'yourApiKey',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'yourApiSecret'
});

// ========== INITIALIZE APP ==========
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000;

// ========== RATE LIMITING ==========
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many requests from this IP, please try again later.'
});

// ========== MIDDLEWARE ==========
app.use(helmet());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload({
  useTempFiles: true,
  limits: { fileSize: 50 * 1024 * 1024 }
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'yourSecretKey',
  resave: false,
  saveUninitialized: false,
}));

// Serve static assets
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Ensure required directories exist
['./uploads', './uploads/videos', './uploads/profiles', './uploads/backgrounds', './uploads/thumbnails']
  .forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir); });

// ========== DATABASE & SCHEMAS ==========
mongoose.connect(process.env.MONGODB_URI || 'yourMongoDB_URI', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  username:      { type: String, unique: true, trim: true },
  email:         { type: String, required: true, trim: true },
  password:      String,
  isAdmin:       { type: Boolean, default: false },
  banned:        { type: Boolean, default: false },
  verified:      { type: Boolean, default: false },
  subscribers:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  profilePic:    { type: String, default: 'https://via.placeholder.com/150/ffffff/000000?text=No+Pic' },
  backgroundPic: { type: String, default: '/uploads/backgrounds/default.png' },
  about:         { type: String, default: '' },
  streamKey:     { type: String, default: '' },
  warnings: [{
    message: String,
    date: { type: Date, default: Date.now }
  }]
});

const videoSchema = new mongoose.Schema({
  title:        String,
  description:  String,
  filePath:     String,
  thumbnail:    { type: String, default: '/uploads/thumbnails/default.png' },
  category:     { type: String, default: 'General' },
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  likes:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dislikes:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    comment: String,
    date:    { type: Date, default: Date.now }
  }],
  reports: [{
    user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    date:   { type: Date, default: Date.now }
  }],
  uploadDate:   { type: Date, default: Date.now },
  viewCount:    { type: Number, default: 0 }
});

const User  = mongoose.model('User', userSchema);
const Video = mongoose.model('Video', videoSchema);

// ========== HELPER FUNCTIONS ==========
const isAuthenticated = async (req, res, next) => {
  if (req.session.userId) return next();
  return res.redirect('/login');
};

const isAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) return res.send('Access denied.');
    next();
  } catch (err) {
    console.error('Admin check error:', err);
    res.send('Internal server error.');
  }
};

function autoLink(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}

function renderPage(content, req) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <title>New Media Hub</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Bootstrap 5.3 -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
    <style>
      :root {
        --primary: #0d6efd;
        --dark-bg: #121212;
        --light-bg: #f8f9fa;
        --text-dark: #212529;
        --text-light: #ffffff;
      }
      body {
        background: var(--light-bg);
        color: var(--text-dark);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        transition: background 0.3s, color 0.3s;
      }
      body.dark-mode {
        background: var(--dark-bg);
        color: var(--text-light);
      }
      .navbar, .footer {
        transition: background 0.3s;
      }
      .navbar {
        background: var(--primary);
      }
      .navbar a {
        color: var(--text-light) !important;
      }
      .card {
        margin-bottom: 1rem;
      }
      #notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--primary);
        color: var(--text-light);
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 1050;
        display: none;
      }
    </style>
  </head>
  <body>
    <nav class="navbar navbar-expand-lg">
      <div class="container-fluid">
        <a class="navbar-brand" href="/" style="font-weight: bold;">New Media Hub</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarContent">
          <ul class="navbar-nav me-auto mb-2 mb-lg-0">
            <li class="nav-item"><a class="nav-link" href="/">Home</a></li>
            <li class="nav-item"><a class="nav-link" href="/music">Music</a></li>
            <li class="nav-item"><a class="nav-link" href="/gaming">Gaming</a></li>
            <li class="nav-item"><a class="nav-link" href="/news">News</a></li>
            <li class="nav-item"><a class="nav-link" href="/general">General</a></li>
            ${ req.session.userId ? `<li class="nav-item"><a class="nav-link" href="/upload">Upload</a></li>` : '' }
          </ul>
          <form class="d-flex" action="/search" method="GET">
            <input class="form-control me-2" type="search" name="query" placeholder="Search">
            <button class="btn btn-light" type="submit">Search</button>
          </form>
          <button id="darkModeToggle" class="btn btn-outline-light ms-2">Dark Mode</button>
          ${ req.session.userId ? 
            `<a class="btn btn-outline-light ms-2" href="/profile/${req.session.userId}">Profile</a>
             <a class="btn btn-outline-light ms-2" href="/logout">Logout</a>` 
            : `<a class="btn btn-outline-light ms-2" href="/login">Login</a>
               <a class="btn btn-outline-light ms-2" href="/signup">Sign Up</a>`
          }
        </div>
      </div>
    </nav>
    <div id="notification"></div>
    <div class="container my-4">
      ${content}
    </div>
    <footer class="footer bg-primary text-center text-light py-3">
      <div class="container">
        <span>&copy; ${new Date().getFullYear()} New Media Hub. All rights reserved.</span>
      </div>
    </footer>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      // Socket.IO notifications
      const socket = io();
      socket.on('notification', (msg) => {
        const notif = document.getElementById('notification');
        notif.innerText = msg;
        notif.style.display = 'block';
        setTimeout(() => { notif.style.display = 'none'; }, 3000);
      });
      // Dark mode toggle
      const darkModeToggle = document.getElementById('darkModeToggle');
      darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        darkModeToggle.innerText = document.body.classList.contains('dark-mode') ? 'Light Mode' : 'Dark Mode';
      });
    </script>
  </body>
  </html>
  `;
}

// ========== CREATE DEFAULT ADMIN ==========
async function createDefaultAdmin() {
  try {
    const adminUsername = 'admin';
    let admin = await User.findOne({ username: adminUsername });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      admin = new User({
        username: adminUsername,
        email: 'admin@example.com',
        password: hashedPassword,
        isAdmin: true,
        verified: true
      });
      await admin.save();
      console.log('Default admin created: admin (password: admin123)');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }
}
createDefaultAdmin();

// ========== ROUTES ==========

// Home Page - Latest, Popular, Trending
app.get('/', async (req, res) => {
  try {
    let videos = await Video.find({}).populate('owner');
    const sortVideos = (field, limit = 5) =>
      [...videos].sort((a, b) => b[field] - a[field]).slice(0, limit);

    const renderSection = (title, vids, metric) => {
      let html = `<h2 class="mb-3">${title}</h2><div class="row">`;
      vids.forEach(v => {
        html += `
          <div class="col-md-4">
            <div class="card">
              <img src="${v.thumbnail}" class="card-img-top" alt="Thumbnail">
              <div class="card-body">
                <h5 class="card-title">${v.title}</h5>
                <p class="card-text">${v.description.substring(0, 60)}...</p>
                <p class="text-muted">${metric}: ${metric === 'Likes' ? v.likes.length : v.viewCount}</p>
                <a href="/video/${v._id}" class="btn btn-primary">Watch</a>
              </div>
            </div>
          </div>`;
      });
      return html + '</div>';
    };

    const latest = sortVideos('uploadDate');
    const popular = sortVideos('likes', 5);
    const trending = sortVideos('viewCount', 5);

    const pageHtml = renderSection('Latest Videos', latest, 'Uploaded') +
                     renderSection('Popular Videos', popular, 'Likes') +
                     renderSection('Trending Videos', trending, 'Views');
    res.send(renderPage(pageHtml, req));
  } catch (err) {
    console.error('Home route error:', err);
    res.send(renderPage('<h2>Error loading home page.</h2>', req));
  }
});

// Search Videos
app.get('/search', async (req, res) => {
  const query = req.query.query || '';
  try {
    let videos = await Video.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } }
      ]
    });
    let html = `<h2>Search Results for "${query}"</h2><div class="row">`;
    if (videos.length === 0) {
      html += `<p>No videos found.</p>`;
    } else {
      videos.forEach(v => {
        html += `
          <div class="col-md-4">
            <div class="card">
              <img src="${v.thumbnail}" class="card-img-top" alt="Thumbnail">
              <div class="card-body">
                <h5 class="card-title">${v.title}</h5>
                <p class="card-text">${v.description.substring(0, 60)}...</p>
                <a href="/video/${v._id}" class="btn btn-primary">Watch</a>
              </div>
            </div>
          </div>`;
      });
    }
    html += '</div>';
    res.send(renderPage(html, req));
  } catch (err) {
    console.error('Search error:', err);
    res.send(renderPage('<h2>Error processing search.</h2>', req));
  }
});

// Category routes (Music, Gaming, News, General)
['music', 'gaming', 'news', 'general'].forEach(category => {
  app.get(`/${category}`, async (req, res) => {
    try {
      let vids = await Video.find({ category: new RegExp(`^${category}$`, 'i') });
      let html = `<h2>${category.charAt(0).toUpperCase() + category.slice(1)} Videos</h2><div class="row">`;
      vids.forEach(v => {
        html += `
          <div class="col-md-4">
            <div class="card">
              <img src="${v.thumbnail}" class="card-img-top" alt="Thumbnail">
              <div class="card-body">
                <h5 class="card-title">${v.title}</h5>
                <p class="card-text">${v.description.substring(0, 60)}...</p>
                <a href="/video/${v._id}" class="btn btn-primary">Watch</a>
              </div>
            </div>
          </div>`;
      });
      html += '</div>';
      res.send(renderPage(html, req));
    } catch (err) {
      console.error(`${category} error:`, err);
      res.send(renderPage(`<h2>Error loading ${category} videos.</h2>`, req));
    }
  });
});

// ========== AUTHENTICATION ROUTES ==========
app.get('/signup', (req, res) => {
  const html = `
    <h2>Sign Up</h2>
    <form method="POST" action="/signup">
      <div class="mb-3">
        <label>Username:</label>
        <input type="text" name="username" class="form-control" required>
      </div>
      <div class="mb-3">
        <label>Email:</label>
        <input type="email" name="email" class="form-control" required>
      </div>
      <div class="mb-3">
        <label>Password:</label>
        <input type="password" name="password" class="form-control" required>
      </div>
      <button type="submit" class="btn btn-primary">Sign Up</button>
    </form>`;
  res.send(renderPage(html, req));
});

app.post('/signup', authLimiter, async (req, res) => {
  let { username, email, password } = req.body;
  username = username.trim().toLowerCase();
  email = email.trim().toLowerCase();
  if (!username || !email || !password) return res.send('All fields are required.');
  try {
    if (await User.findOne({ username })) return res.send('Username taken.');
    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashed });
    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    console.error('Signup error:', err);
    res.send('Error signing up.');
  }
});

app.get('/login', (req, res) => {
  const html = `
    <h2>Login</h2>
    <form method="POST" action="/login">
      <div class="mb-3">
        <label>Username:</label>
        <input type="text" name="username" class="form-control" required>
      </div>
      <div class="mb-3">
        <label>Password:</label>
        <input type="password" name="password" class="form-control" required>
      </div>
      <button type="submit" class="btn btn-primary">Login</button>
    </form>`;
  res.send(renderPage(html, req));
});

app.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user || user.banned || !(await bcrypt.compare(password, user.password)))
      return res.send('Invalid credentials or banned.');
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin = user.isAdmin;
    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.send('Error logging in.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ========== VIDEO ROUTES ==========
app.get('/upload', isAuthenticated, (req, res) => {
  const html = `
    <h2>Upload Video</h2>
    <form method="POST" action="/upload" enctype="multipart/form-data">
      <div class="mb-3">
        <label>Title:</label>
        <input type="text" name="title" class="form-control" required>
      </div>
      <div class="mb-3">
        <label>Description:</label>
        <textarea name="description" class="form-control" required></textarea>
      </div>
      <div class="mb-3">
        <label>Category:</label>
        <select name="category" class="form-select">
          <option value="Music">Music</option>
          <option value="Gaming">Gaming</option>
          <option value="News">News</option>
          <option value="General" selected>General</option>
        </select>
      </div>
      <div class="mb-3">
        <label>Video File:</label>
        <input type="file" name="videoFile" class="form-control" accept="video/*" required>
      </div>
      <div class="mb-3">
        <label>Thumbnail (optional):</label>
        <input type="file" name="thumbnailFile" class="form-control" accept="image/*">
      </div>
      <button type="submit" class="btn btn-primary">Upload</button>
    </form>`;
  res.send(renderPage(html, req));
});

app.post('/upload', isAuthenticated, async (req, res) => {
  try {
    if (!req.files || !req.files.videoFile) return res.send('No video uploaded.');
    const videoFile = req.files.videoFile;
    // Upload video to Cloudinary
    const videoUpload = await cloudinary.uploader.upload(videoFile.tempFilePath, {
      resource_type: 'video',
      folder: 'videos'
    });
    const videoUrl = videoUpload.secure_url;
    let thumbnailUrl;
    if (req.files.thumbnailFile) {
      const thumbUpload = await cloudinary.uploader.upload(req.files.thumbnailFile.tempFilePath, {
        resource_type: 'image',
        folder: 'thumbnails'
      });
      thumbnailUrl = thumbUpload.secure_url;
    } else {
      // Generate thumbnail via Cloudinary transformation
      thumbnailUrl = cloudinary.url(videoUpload.public_id + '.png', {
        resource_type: 'video',
        format: 'png',
        transformation: [{ width: 320, height: 240, crop: 'fill' }]
      });
    }
    const newVideo = new Video({
      title: req.body.title,
      description: req.body.description,
      filePath: videoUrl,
      thumbnail: thumbnailUrl,
      category: req.body.category || 'General',
      owner: req.session.userId
    });
    await newVideo.save();
    io.emit('notification', 'New video uploaded!');
    res.redirect('/');
  } catch (err) {
    console.error('Upload error:', err);
    res.send('Error uploading video.');
  }
});

app.get('/video/:id', async (req, res) => {
  try {
    let video = await Video.findById(req.params.id)
      .populate('owner')
      .populate('comments.user');
    if (!video) return res.send('Video not found.');
    video.viewCount++;
    await video.save();

    // Suggested videos
    const suggested = await Video.find({
      category: video.category,
      _id: { $ne: video._id }
    }).limit(5);
    let suggestedHtml = `<h4>Suggested Videos</h4><div class="list-group">`;
    suggested.forEach(sv => {
      suggestedHtml += `<a href="/video/${sv._id}" class="list-group-item list-group-item-action">
                          <div class="d-flex">
                            <img src="${sv.thumbnail}" style="width:60px; height:60px; object-fit:cover; margin-right:10px;" alt="Thumb">
                            <div>${sv.title}</div>
                          </div>
                        </a>`;
    });
    suggestedHtml += `</div>`;

    // Action buttons based on user session
    const subscribeButton = req.session.userId && (req.session.userId !== video.owner._id.toString())
      ? `<form method="POST" action="/subscribe/${video.owner._id}" style="display:inline;">
           <button class="btn btn-outline-info">Subscribe</button>
         </form>`
      : '';
    const likeButton = req.session.userId
      ? `<form method="POST" action="/like/${video._id}" style="display:inline;">
           <button class="btn btn-success">Like (${video.likes.length})</button>
         </form>`
      : `<button class="btn btn-success" onclick="alert('Login to like')">Like (${video.likes.length})</button>`;
    const dislikeButton = req.session.userId
      ? `<form method="POST" action="/dislike/${video._id}" style="display:inline;">
           <button class="btn btn-warning">Dislike (${video.dislikes.length})</button>
         </form>`
      : `<button class="btn btn-warning" onclick="alert('Login to dislike')">Dislike (${video.dislikes.length})</button>`;

    let commentForm = req.session.userId
      ? `<form method="POST" action="/comment/${video._id}">
           <div class="mb-3">
             <textarea name="comment" class="form-control" placeholder="Add a comment..." required></textarea>
           </div>
           <button type="submit" class="btn btn-primary">Comment</button>
         </form>`
      : `<p><em>Login to comment.</em></p>`;

    let commentsHtml = `<h5>Comments</h5>`;
    video.comments.forEach(c => {
      commentsHtml += `<p><strong>${c.user.username}:</strong> ${c.comment}</p>`;
    });

    const pageHtml = `
      <div class="row">
        <div class="col-md-8">
          <h2>${video.title}</h2>
          <video width="100%" controls>
            <source src="${video.filePath}" type="video/mp4">
            Your browser does not support HTML5 video.
          </video>
          <p>${autoLink(video.description)}</p>
          <p>Category: ${video.category}</p>
          <p>Views: ${video.viewCount}</p>
          ${subscribeButton} ${likeButton} ${dislikeButton}
          <hr>
          ${commentForm}
          ${commentsHtml}
        </div>
        <div class="col-md-4">
          ${suggestedHtml}
        </div>
      </div>
    `;
    res.send(renderPage(pageHtml, req));
  } catch (err) {
    console.error('Video display error:', err);
    res.send('Error displaying video.');
  }
});

// Like video
app.post('/like/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    // Remove dislike if exists
    video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    if (video.likes.includes(req.session.userId)) {
      video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      video.likes.push(req.session.userId);
      io.emit('notification', `${req.session.username} liked "${video.title}"`);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    console.error('Like error:', err);
    res.send('Error processing like.');
  }
});

// Dislike video
app.post('/dislike/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    if (video.dislikes.includes(req.session.userId)) {
      video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      video.dislikes.push(req.session.userId);
      io.emit('notification', `${req.session.username} disliked "${video.title}"`);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    console.error('Dislike error:', err);
    res.send('Error processing dislike.');
  }
});

// Add comment
app.post('/comment/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.comments.push({ user: req.session.userId, comment: req.body.comment });
    await video.save();
    io.emit('notification', 'New comment added!');
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    console.error('Comment error:', err);
    res.send('Error adding comment.');
  }
});

// Subscribe/Unsubscribe
app.post('/subscribe/:ownerId', isAuthenticated, async (req, res) => {
  try {
    let owner = await User.findById(req.params.ownerId);
    let user = await User.findById(req.session.userId);
    if (!owner || !user) return res.send('User not found.');
    if (owner._id.toString() === user._id.toString())
      return res.send('Cannot subscribe to yourself.');
    if (owner.subscribers.includes(user._id)) {
      owner.subscribers = owner.subscribers.filter(sid => sid.toString() !== user._id.toString());
    } else {
      owner.subscribers.push(user._id);
    }
    await owner.save();
    io.emit('notification', `${user.username} updated subscription for ${owner.username}`);
    res.redirect('back');
  } catch (err) {
    console.error('Subscribe error:', err);
    res.send('Error updating subscription.');
  }
});

// Profile routes
app.get('/profile/:id', async (req, res) => {
  try {
    let userProfile = await User.findById(req.params.id);
    if (!userProfile) return res.send('User not found.');
    let vids = await Video.find({ owner: req.params.id });
    let videosHtml = '<div class="row">';
    vids.forEach(v => {
      videosHtml += `
        <div class="col-md-4">
          <div class="card">
            <img src="${v.thumbnail}" class="card-img-top" alt="Thumbnail">
            <div class="card-body">
              <h5 class="card-title">${v.title}</h5>
              <a href="/video/${v._id}" class="btn btn-primary">Watch</a>
            </div>
          </div>
        </div>`;
    });
    videosHtml += '</div>';

    let profileHtml = `
      <div class="text-center">
        <img src="${userProfile.profilePic}" alt="Profile Pic" style="width:150px;height:150px;object-fit:cover;border-radius:50%;">
        <h2>${userProfile.username} ${userProfile.verified ? '<span class="badge bg-success">Verified</span>' : ''}</h2>
        <p>${userProfile.about}</p>
        <p>Subscribers: ${userProfile.subscribers.length}</p>
      </div>
      ${videosHtml}
    `;
    res.send(renderPage(profileHtml, req));
  } catch (err) {
    console.error('Profile error:', err);
    res.send('Error loading profile.');
  }
});

// Update profile (only basic info)
app.post('/updateProfile', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if (!user) return res.send('User not found.');
    if (req.files && req.files.profilePic) {
      const picUpload = await cloudinary.uploader.upload(req.files.profilePic.tempFilePath, {
        resource_type: 'image',
        folder: 'profiles'
      });
      user.profilePic = picUpload.secure_url;
    }
    user.about = req.body.about;
    await user.save();
    res.redirect('/profile/' + req.session.userId);
  } catch (err) {
    console.error('Profile update error:', err);
    res.send('Error updating profile.');
  }
});

// Admin Panel Routes
app.get('/admin', isAdmin, async (req, res) => {
  try {
    const users = await User.find({});
    let usersHtml = `<h2>Admin Panel - Users</h2>`;
    users.forEach(u => {
      usersHtml += `
        <div class="card mb-2">
          <div class="card-body">
            <strong>${u.username}</strong> - ${u.banned ? '<span class="text-danger">Banned</span>' : 'Active'}
            ${u._id.toString() !== req.session.userId ? `
              <form method="POST" action="/ban/${u._id}" style="display:inline;">
                <button class="btn btn-danger btn-sm">Ban/Unban</button>
              </form>
              <form method="POST" action="/admin/delete/user/${u._id}" style="display:inline;">
                <button class="btn btn-danger btn-sm">Delete</button>
              </form>
              <form method="POST" action="/admin/warn/${u._id}" style="display:inline;">
                <input type="text" name="message" placeholder="Warn message" required>
                <button class="btn btn-warning btn-sm">Warn</button>
              </form>
            ` : '' }
            ${!u.verified ? `<form method="POST" action="/verify/${u._id}" style="display:inline;">
              <button class="btn btn-info btn-sm">Verify</button>
            </form>` : ''}
          </div>
        </div>`;
    });
    const videos = await Video.find({}).populate('owner');
    let videosHtml = `<h2 class="mt-4">Admin Panel - Videos</h2>`;
    videos.forEach(v => {
      videosHtml += `
        <div class="card mb-2">
          <div class="card-body">
            <strong>${v.title}</strong> by ${v.owner ? v.owner.username : 'Unknown'}
            <form method="POST" action="/admin/delete/video/${v._id}" style="display:inline;">
              <button class="btn btn-danger btn-sm">Delete</button>
            </form>
          </div>
        </div>`;
    });
    res.send(renderPage(usersHtml + videosHtml, req));
  } catch (err) {
    console.error('Admin panel error:', err);
    res.send('Error loading admin panel.');
  }
});

app.post('/ban/:id', isAdmin, async (req, res) => {
  try {
    let u = await User.findById(req.params.id);
    if (!u) return res.send('User not found.');
    u.banned = !u.banned;
    await u.save();
    res.redirect('/admin');
  } catch (err) {
    console.error('Ban error:', err);
    res.send('Error updating ban status.');
  }
});

app.post('/verify/:id', isAdmin, async (req, res) => {
  try {
    let u = await User.findById(req.params.id);
    if (!u) return res.send('User not found.');
    u.verified = true;
    await u.save();
    res.redirect('/admin');
  } catch (err) {
    console.error('Verify error:', err);
    res.send('Error verifying user.');
  }
});

app.post('/admin/warn/:id', isAdmin, async (req, res) => {
  try {
    let u = await User.findById(req.params.id);
    if (!u) return res.send('User not found.');
    u.warnings.push({ message: req.body.message });
    await u.save();
    io.emit('notification', `Admin warned ${u.username}: ${req.body.message}`);
    res.redirect('/admin');
  } catch (err) {
    console.error('Warn error:', err);
    res.send('Error warning user.');
  }
});

app.post('/admin/delete/video/:id', isAdmin, async (req, res) => {
  try {
    await Video.deleteOne({ _id: req.params.id });
    res.redirect('/admin');
  } catch (err) {
    console.error('Delete video error:', err);
    res.send('Error deleting video.');
  }
});

app.post('/admin/delete/user/:id', isAdmin, async (req, res) => {
  try {
    await User.deleteOne({ _id: req.params.id });
    res.redirect('/admin');
  } catch (err) {
    console.error('Delete user error:', err);
    res.send('Error deleting user.');
  }
});

// ========== API Endpoint ==========
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find({}).populate('owner', 'username profilePic');
    res.json(videos);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Error fetching videos.' });
  }
});

// ========== CATCH-ALL ==========
app.use((req, res) => {
  res.status(404).send(renderPage('<h2>404 - Page Not Found</h2>', req));
});

// ========== START SERVER ==========
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
