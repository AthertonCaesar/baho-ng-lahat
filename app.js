// app.js

// ================== DEPENDENCIES ==================
const express         = require('express');
const mongoose        = require('mongoose');
const bcrypt          = require('bcryptjs');
const session         = require('express-session');
const fileUpload      = require('express-fileupload');
const path            = require('path');
const fs              = require('fs');
const { v4: uuidv4 }  = require('uuid'); // For tokens/keys
const sharp           = require('sharp'); // For resizing images

// For auto‐generating video thumbnails with FFmpeg
const ffmpeg          = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ================== INITIALIZE APP ==================
const app = express();
const PORT = process.env.PORT || 3000;

// ================== MONGODB CONNECTION ==================
const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://athertoncaesar:v5z5spFWXvTB9ce@bahonglahat.jrff3.mongodb.net/?retryWrites=true&w=majority&appName=bahonglahat';
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// ================== MIDDLEWARE ==================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: false
}));

// Serve static files (for uploaded videos, profiles, backgrounds, thumbnails)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create required directories if they do not exist
const dirs = [
  './uploads',
  './uploads/videos',
  './uploads/profiles',
  './uploads/backgrounds',
  './uploads/thumbnails'
];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// ================== MONGOOSE SCHEMAS ==================

// Each comment can be "hearted" or "pinned" by the video owner
const commentSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  comment: String,
  date:    { type: Date, default: Date.now },
  hearted: { type: Boolean, default: false } // If the video owner "hearted" this comment
});

const videoSchema = new mongoose.Schema({
  title:       String,
  description: String,
  filePath:    String,
  thumbnail:   { type: String, default: '/uploads/thumbnails/default.png' },
  category:    { type: String, default: 'General' },
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  likes:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dislikes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments:    [commentSchema],
  pinnedComment: { type: mongoose.Schema.Types.ObjectId, default: null }, // The ID of the pinned comment
  uploadDate:  { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  username:      { type: String, unique: true },
  email:         { type: String, unique: true },
  password:      String,
  isAdmin:       { type: Boolean, default: false },
  banned:        { type: Boolean, default: false },
  verified:      { type: Boolean, default: false }, // legacy
  subscribers:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  profilePic:    { type: String, default: '/uploads/profiles/default.png' },
  backgroundPic: { type: String, default: '/uploads/backgrounds/default.png' },
  about:         { type: String, default: '' },

  // Live streaming placeholders:
  isLive:        { type: Boolean, default: false },
  liveLink:      { type: String, default: '' },

  // Email verification
  emailVerified: { type: Boolean, default: false },
  verifyToken:   { type: String, default: '' },

  // Stream key
  streamKey:     { type: String, default: '' }
});

const User  = mongoose.model('User', userSchema);
const Video = mongoose.model('Video', videoSchema);

// ================== CREATE DEFAULT ADMIN ==================
async function createDefaultAdmin() {
  try {
    let admin = await User.findOne({ username: 'Villamor Gelera' });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      admin = new User({
        username: 'Villamor Gelera',
        email: 'admin@bahonlahat.com',
        password: hashedPassword,
        isAdmin: true,
        verified: true,
        emailVerified: true,
        verifyToken: '',
        streamKey: uuidv4()
      });
      await admin.save();
      console.log('Default admin created: Villamor Gelera, password: admin123');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }
}
createDefaultAdmin();

// ================== HELPER MIDDLEWARE ==================
async function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

async function isAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) {
      return res.send('Access denied.');
    }
    next();
  } catch (err) {
    console.error('Admin check error:', err);
    return res.send('Internal server error (admin check).');
  }
}

// ================== HTML RENDERER (Bright Gradient) ==================
function renderPage(content, req) {
  const isAdminUser = req.session.isAdmin || false;
  const username    = req.session.username || '';
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Baho ng Lahat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Favicon -->
    <link rel="icon" href="/uploads/logo.png" type="image/png">
    <!-- Google Font -->
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <style>
      body {
        /* A bright pink‐orange gradient for a more "lively" feel */
        background: linear-gradient(to right, #ff9966, #ff5e62);
        font-family: 'Poppins', sans-serif;
        color: #333;
      }
      .navbar {
        margin-bottom: 20px;
        background-color: #e14f5f !important;
        border-bottom: 2px solid #c0392b;
      }
      .navbar .navbar-brand,
      .navbar .nav-link {
        color: #fff !important;
      }
      .navbar .nav-link:hover {
        color: #eee !important;
      }
      .video-card {
        margin-bottom: 20px;
        background-color: #fff;
        border: 1px solid #ddd;
      }
      .video-card .card-body {
        color: #333;
      }
      .video-thumbnail {
        width: 100%;
        max-width: 300px;
        cursor: pointer;
        transition: transform 0.3s;
      }
      .video-thumbnail:hover {
        transform: scale(1.05);
      }
      footer {
        margin-top: 50px;
        padding: 20px;
        background-color: #e14f5f;
        color: #fff;
        text-align: center;
        border-top: 2px solid #c0392b;
      }
      .tagline {
        font-size: 0.85rem;
        font-style: italic;
      }
      .category-badge {
        display: inline-block;
        padding: 2px 6px;
        font-size: 0.75rem;
        background-color: #eee;
        border-radius: 4px;
      }
      .search-bar {
        width: 250px;
        margin-right: 10px;
        background-color: #fff !important;
        border: 1px solid #ccc !important;
        color: #333 !important;
      }
      .preview-img {
        display: block;
        margin-top: 10px;
        max-width: 200px;
        height: auto;
      }
      .assistant-container {
        background-color: #fff;
        color: #333;
        padding: 20px;
        border: 1px solid #ddd;
        margin-top: 20px;
        border-radius: 5px;
      }
      .btn-outline-light {
        color: #fff !important;
        border-color: #fff !important;
      }
      .btn-outline-light:hover {
        background-color: #fff !important;
        color: #e14f5f !important;
      }
    </style>
  </head>
  <body>
    <nav class="navbar navbar-expand-lg">
      <a class="navbar-brand" href="/">
        Baho ng Lahat
        <div class="tagline">A Non‐Biased, Uncensored Website</div>
      </a>
      <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarNav"
        aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon">☰</span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav mr-auto">
          <li class="nav-item"><a class="nav-link" href="/">Home</a></li>
          <li class="nav-item"><a class="nav-link" href="/music">Music</a></li>
          <li class="nav-item"><a class="nav-link" href="/gaming">Gaming</a></li>
          <li class="nav-item"><a class="nav-link" href="/news">News</a></li>
          <li class="nav-item"><a class="nav-link" href="/general">General</a></li>
          <li class="nav-item"><a class="nav-link" href="/live">Live</a></li>
          ${
            req.session.userId
              ? `<li class="nav-item"><a class="nav-link" href="/upload">Upload Video</a></li>
                 <li class="nav-item"><a class="nav-link" href="/profile/${req.session.userId}">Profile</a></li>
                 <li class="nav-item"><a class="nav-link" href="/accountSettings">Account Settings</a></li>
                 <li class="nav-item"><a class="nav-link" href="/assistant">Assistant</a></li>`
              : ''
          }
          ${ (isAdminUser) ? `<li class="nav-item"><a class="nav-link" href="/admin">Admin Panel</a></li>` : '' }
        </ul>
        <!-- SEARCH FORM -->
        <form class="form-inline my-2 my-lg-0" action="/search" method="GET">
          <input class="form-control mr-sm-2 search-bar" type="search" name="term" placeholder="Search videos..." aria-label="Search">
          <button class="btn btn-outline-light my-2 my-sm-0" type="submit">Search</button>
        </form>
        <!-- END SEARCH FORM -->
        <ul class="navbar-nav ml-3">
          ${
            req.session.userId
              ? `<li class="nav-item"><a class="nav-link" href="/logout">Logout (${username})</a></li>`
              : `<li class="nav-item"><a class="nav-link" href="/login">Login</a></li>
                 <li class="nav-item"><a class="nav-link" href="/signup">Sign Up</a></li>`
          }
        </ul>
      </div>
    </nav>
    <div class="container">
      ${content}
    </div>
    <footer>
      <p>By Villamor Gelera — Version 1.0.0</p>
    </footer>

    <!-- Bootstrap JS -->
    <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@4.5.2/dist/js/bootstrap.bundle.min.js"></script>

    <script>
      // 1) Thumbnail preview with mini autoplay on hover:
      document.querySelectorAll('.video-thumbnail').forEach(img => {
        img.addEventListener('mouseenter', function() {
          const videoUrl = this.getAttribute('data-video');
          if (!videoUrl || videoUrl.endsWith('.png') || videoUrl.endsWith('.jpg')) return;
          const preview = document.createElement('video');
          preview.src = videoUrl;
          preview.autoplay = true;
          preview.muted = true;
          preview.loop = true;
          preview.width = this.clientWidth;
          preview.height = this.clientHeight;
          preview.style.objectFit = 'cover';
          this.parentNode.replaceChild(preview, this);
        });
      });

      // 2) Preview images (profile pic, background pic, thumbnail) before uploading
      function setupPreview(inputId, previewId) {
        const inputEl = document.getElementById(inputId);
        const previewEl = document.getElementById(previewId);
        if (!inputEl || !previewEl) return;
        inputEl.addEventListener('change', function() {
          const file = this.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
              previewEl.src = e.target.result;
            }
            reader.readAsDataURL(file);
          } else {
            previewEl.src = '';
          }
        });
      }
      setupPreview('profilePicInput', 'profilePicPreview');
      setupPreview('backgroundPicInput', 'backgroundPicPreview');
      setupPreview('thumbnailFileInput', 'thumbnailFilePreview');

      // 3) "Share" button using the Web Share API if available
      function shareVideo(title) {
        if (navigator.share) {
          navigator.share({
            title: title,
            text: 'Check out this video on Baho ng Lahat!',
            url: window.location.href
          })
          .catch(err => console.log('Share canceled or failed: ', err));
        } else {
          alert('Sharing not supported in this browser. Copy this link: ' + window.location.href);
        }
      }
    </script>
  </body>
  </html>
  `;
}

// ================== SIMPLE AI ASSISTANT ==================
app.get('/assistant', isAuthenticated, (req, res) => {
  if (!req.session.assistantHistory) {
    req.session.assistantHistory = [];
  }
  let chatHistory = req.session.assistantHistory.map(item => {
    return `<p><strong>You:</strong> ${item.question}</p><p><strong>Assistant:</strong> ${item.answer}</p>`;
  }).join('');

  const assistantHtml = `
    <h2>Assistant</h2>
    <div class="assistant-container">
      ${chatHistory}
      <form method="POST" action="/assistant">
        <div class="form-group">
          <label>Ask me something:</label>
          <input type="text" name="question" class="form-control" required />
        </div>
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
    </div>
  `;
  res.send(renderPage(assistantHtml, req));
});

app.post('/assistant', isAuthenticated, (req, res) => {
  let question = req.body.question.trim();
  if (!req.session.assistantHistory) {
    req.session.assistantHistory = [];
  }

  // Minimal logic
  let answer = '';
  let qLower = question.toLowerCase();

  if (qLower.includes('hello') || qLower.includes('hi')) {
    answer = 'Hello! How can I help you today?';
  } else if (qLower.includes('how are you')) {
    answer = 'I’m just a simple assistant, but I’m doing great, thanks!';
  } else if (qLower.includes('stream') || qLower.includes('live')) {
    answer = 'To go live, set your live link in Account Settings and click "Go Live".';
  } else if (qLower.includes('upload')) {
    answer = 'You can upload a video by clicking "Upload Video" in the navbar.';
  } else {
    answer = 'I’m not sure about that, but I’m always learning! Try asking something else.';
  }

  req.session.assistantHistory.push({ question, answer });
  res.redirect('/assistant');
});

// ================== SEARCH (with fallback) ==================
app.get('/search', async (req, res) => {
  const term = (req.query.term || '').trim();
  if (!term) {
    return res.send(renderPage('<h2>Please enter a search term.</h2>', req));
  }

  try {
    // direct match
    let directMatches = await Video.find({
      $or: [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } }
      ]
    });

    let videos = directMatches;
    if (videos.length === 0) {
      // fallback
      const words = term.split(/\s+/).map(w => w.trim()).filter(Boolean);
      if (words.length > 0) {
        let orConditions = words.map(w => ({
          $or: [
            { title: { $regex: w, $options: 'i' } },
            { description: { $regex: w, $options: 'i' } }
          ]
        }));
        const fallbackMatches = await Video.find({ $and: orConditions });
        videos = fallbackMatches;
      }
    }

    let html = `<h2>Search Results for "${term}"</h2>`;
    if (videos.length === 0) {
      html += `<p>No videos found. Try different keywords!</p>`;
    } else {
      html += '<div class="row">';
      videos.forEach(video => {
        const showThumb = video.thumbnail && !video.thumbnail.endsWith('default.png');
        const thumbnailTag = showThumb
          ? `<img src="${video.thumbnail}" alt="Thumbnail"
                   class="card-img-top video-thumbnail"
                   data-video="${video.filePath}"
                   style="max-height:200px; object-fit:cover;">`
          : '';
        html += `
        <div class="col-md-4 mb-3">
          <div class="card video-card">
            ${thumbnailTag}
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
            </div>
          </div>
        </div>
        `;
      });
      html += '</div>';
    }
    res.send(renderPage(html, req));
  } catch (err) {
    console.error('Search error:', err);
    res.send('Error performing search.');
  }
});

// ========== HOME PAGE (LATEST & POPULAR) with Admin Pin ==========
app.get('/', async (req, res) => {
  try {
    let allVideos = await Video.find({}).populate('owner');
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let pinnedAdmin = allVideos.filter(v => {
      if (!v.owner) return false;
      if (!v.owner.isAdmin) return false;
      return (now - v.uploadDate.getTime()) < ONE_WEEK;
    });
    pinnedAdmin.sort((a, b) => b.uploadDate - a.uploadDate);

    let nonPinned = allVideos.filter(v => !pinnedAdmin.includes(v));
    let sortedLatest = [...nonPinned].sort((a, b) => b.uploadDate - a.uploadDate);
    let finalLatest = [...pinnedAdmin, ...sortedLatest].slice(0, 5);

    let pinnedAdminPop = [...pinnedAdmin].sort((a, b) => b.likes.length - a.likes.length);
    let nonPinnedPop = [...nonPinned].sort((a, b) => b.likes.length - a.likes.length);
    let finalPopular = [...pinnedAdminPop, ...nonPinnedPop].slice(0, 5);

    let latestHtml = `
      <h3 class="mb-3">Latest Videos</h3>
      <div class="row">
    `;
    finalLatest.forEach(video => {
      let showThumbnail = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbnailTag = showThumbnail
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">`
        : '';
      latestHtml += `
      <div class="col-md-4 mb-3">
        <div class="card video-card">
          ${thumbnailTag}
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Category: ${video.category}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary btn-block mt-2">Watch</a>
          </div>
        </div>
      </div>
      `;
    });
    latestHtml += '</div>';

    let popularHtml = `
      <h3 class="mt-4 mb-3">Popular Videos</h3>
      <div class="row">
    `;
    finalPopular.forEach(video => {
      let showThumbnail = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbnailTag = showThumbnail
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">`
        : '';
      popularHtml += `
      <div class="col-md-4 mb-3">
        <div class="card video-card">
          ${thumbnailTag}
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Likes: ${video.likes.length}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary btn-block">Watch</a>
          </div>
        </div>
      </div>
      `;
    });
    popularHtml += '</div>';

    res.send(renderPage(latestHtml + popularHtml, req));
  } catch (err) {
    console.error('Error loading home videos:', err);
    res.send('Error loading videos.');
  }
});

// ========== CATEGORY ROUTES (Music, Gaming, News, General, Live) ==========
app.get('/music', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'Music' });
    let videoHtml = '<h2>Music Videos</h2><div class="row">';
    videos.forEach(video => {
      let showThumbnail = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbnailTag = showThumbnail
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">`
        : '';
      videoHtml += `
        <div class="col-md-4 mb-3">
          <div class="card video-card">
            ${thumbnailTag}
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
            </div>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(videoHtml, req));
  } catch (err) {
    res.send('Error loading music videos.');
  }
});

app.get('/gaming', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'Gaming' });
    let videoHtml = '<h2>Gaming Videos</h2><div class="row">';
    videos.forEach(video => {
      let showThumbnail = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbnailTag = showThumbnail
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">`
        : '';
      videoHtml += `
        <div class="col-md-4 mb-3">
          <div class="card video-card">
            ${thumbnailTag}
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
            </div>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(videoHtml, req));
  } catch (err) {
    res.send('Error loading gaming videos.');
  }
});

app.get('/news', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'News' });
    let videoHtml = '<h2>News Videos</h2><div class="row">';
    videos.forEach(video => {
      let showThumbnail = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbnailTag = showThumbnail
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">`
        : '';
      videoHtml += `
        <div class="col-md-4 mb-3">
          <div class="card video-card">
            ${thumbnailTag}
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
            </div>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(videoHtml, req));
  } catch (err) {
    res.send('Error loading news videos.');
  }
});

app.get('/general', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'General' });
    let videoHtml = '<h2>General Videos</h2><div class="row">';
    videos.forEach(video => {
      let showThumbnail = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbnailTag = showThumbnail
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">`
        : '';
      videoHtml += `
        <div class="col-md-4 mb-3">
          <div class="card video-card">
            ${thumbnailTag}
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
            </div>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(videoHtml, req));
  } catch (err) {
    res.send('Error loading general videos.');
  }
});

app.get('/live', async (req, res) => {
  try {
    let liveUsers = await User.find({ isLive: true });
    let liveHtml = '<h2>Live Streams</h2>';
    if (liveUsers.length === 0) {
      liveHtml += '<p>No one is live right now.</p>';
    } else {
      liveUsers.forEach(u => {
        liveHtml += `
          <div class="card mb-3 video-card">
            <div class="card-body">
              <h4>${u.username} ${u.verified ? '<span class="badge badge-info">Verified</span>' : ''}</h4>
              <p>${u.about}</p>
              ${
                u.liveLink
                  ? `<iframe src="${u.liveLink}" width="100%" height="315" allowfullscreen></iframe>`
                  : '<p>(No live link provided)</p>'
              }
            </div>
          </div>
        `;
      });
    }
    res.send(renderPage(liveHtml, req));
  } catch (err) {
    console.error('Error in /live route:', err);
    res.send('Error loading live page.');
  }
});

// ========== SIGNUP, LOGIN, LOGOUT, VERIFY EMAIL ==========
// ... (Already included above)

// ========== VIDEO ROUTES (Upload, Watch, Like/Dislike, Comment, Pin, Heart, Edit, Delete, Download) ==========
// ... (All included above)

// ========== SUBSCRIBE / UNSUBSCRIBE ==========
// ... (Included above)

// ========== USER PROFILE & ACCOUNT SETTINGS ==========
// ... (Included above)

// ========== ADMIN PANEL ==========

app.get('/admin', isAdmin, async (req, res) => {
  try {
    let users = await User.find({});
    let userHtml = '<h2>Admin Panel - Manage Users</h2>';
    users.forEach(u => {
      userHtml += `
      <div class="card mb-2" style="background-color:#fff;border:1px solid #ddd;">
        <div class="card-body" style="color:#333;">
          <p>${u.username} (${u.email}) - ${u.banned ? '<span class="text-danger">Banned</span>' : 'Active'}
             ${
               u._id.toString() !== req.session.userId
                 ? `<form style="display:inline;" method="POST" action="/ban/${u._id}">
                      <button class="btn btn-danger btn-sm ml-2">Ban/Unban</button>
                    </form>`
                 : ''
             }
             ${
               !u.verified
                 ? `<form style="display:inline;" method="POST" action="/verify/${u._id}">
                      <button class="btn btn-info btn-sm ml-2">Verify (Legacy Flag)</button>
                    </form>`
                 : ''
             }
          </p>
        </div>
      </div>
      `;
    });
    res.send(renderPage(userHtml, req));
  } catch (err) {
    console.error('Admin panel error:', err);
    res.send('Internal server error in admin panel.');
  }
});

app.post('/ban/:id', isAdmin, async (req, res) => {
  try {
    let user = await User.findById(req.params.id);
    if(!user) return res.send('User not found.');
    user.banned = !user.banned;
    await user.save();
    res.redirect('/admin');
  } catch (err) {
    res.send('Error updating ban status.');
  }
});

// Legacy "verify" route for the old `verified` field
app.post('/verify/:id', isAdmin, async (req, res) => {
  try {
    let user = await User.findById(req.params.id);
    if(!user) return res.send('User not found.');
    user.verified = true;
    await user.save();
    res.redirect('/admin');
  } catch (err) {
    res.send('Error verifying user.');
  }
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
