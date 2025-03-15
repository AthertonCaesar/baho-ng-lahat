// ================== DEPENDENCIES ==================
const express       = require('express');
const mongoose      = require('mongoose');
const bcrypt        = require('bcryptjs');
const session       = require('express-session');
const fileUpload    = require('express-fileupload');
const path          = require('path');
const fs            = require('fs');

// For auto-generating thumbnails (requires FFmpeg):
const ffmpeg        = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Cloudinary for persistent storage
const cloudinary    = require('cloudinary').v2;
cloudinary.config({
  cloud_name: 'df0yc1cvr',      // Replace with your Cloudinary cloud name
  api_key: '143758952799997',   // Replace with your Cloudinary API key
  api_secret: 'a9TyH_t9lqZvem3cKkYSoXJ_6-E' // Replace with your Cloudinary API secret
});

// ================== INITIALIZE APP & SOCKET.IO ==================
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const PORT = process.env.PORT || 3000;

// ================== MONGODB CONNECTION ==================
const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://athertoncaesar:v5z5spFWXvTB9ce@bahonglahat.jrff3.mongodb.net/?retryWrites=true&w=majority&appName=bahonglahat';
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// ================== MIDDLEWARE ==================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload({ useTempFiles: true }));
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
const userSchema = new mongoose.Schema({
  username:      { type: String, unique: true }, 
  email:         { type: String, required: true },
  password:      String,
  isAdmin:       { type: Boolean, default: false },
  banned:        { type: Boolean, default: false },
  verified:      { type: Boolean, default: false },
  subscribers:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  profilePic:    { 
    type: String, 
    default: 'https://via.placeholder.com/150/ffffff/000000?text=No+Pic' 
  },
  backgroundPic: { type: String, default: '/uploads/backgrounds/default.png' },
  about:         { type: String, default: '' },
  streamKey:     { type: String, default: '' }, // No longer exposed in UI
  warnings: [
    {
      message: String,
      date: { type: Date, default: Date.now }
    }
  ]
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
  comments: [
    {
      user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      comment: String,
      date:    { type: Date, default: Date.now }
    }
  ],
  reports: [
    {
      user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      date:   { type: Date, default: Date.now }
    }
  ],
  uploadDate:   { type: Date, default: Date.now },
  viewCount:    { type: Number, default: 0 }
});

const User  = mongoose.model('User', userSchema);
const Video = mongoose.model('Video', videoSchema);

// ================== CREATE DEFAULT ADMIN ==================
async function createDefaultAdmin() {
  try {
    const adminUsername = 'villamor gelera';
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
      console.log('Default admin created: villamor gelera, password: admin123');
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

// ================== AUTO-LINK FUNCTION ==================
function autoLink(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}

// ================== HTML RENDERER (YOUTUBE-INSPIRED) ==================
function renderPage(content, req) {
  // Note: We’re using a layout that’s reminiscent of YouTube: top nav, left sidebar with icons, main grid for videos
  return `
  <!DOCTYPE html>
  <html>
  <head>
      <title>My YT-Inspired Site</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <!-- Bootstrap 5 -->
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <!-- Bootstrap Icons -->
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
      <!-- Google Fonts -->
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
          :root {
              --yt-red: #ff0000;
              --yt-light-bg: #f9f9f9;
              --yt-dark-bg: #181818;
              --yt-hover: #e5e5e5;
              --primary-color: #ff0000; /* for buttons, highlights, etc. */
          }
          body {
              font-family: 'Inter', system-ui, -apple-system, sans-serif;
              margin: 0;
              padding: 0;
              background: var(--yt-light-bg);
              color: #0f0f0f;
          }
          /* Top navbar */
          .yt-nav {
              display: flex;
              align-items: center;
              justify-content: space-between;
              background: #fff;
              height: 56px;
              border-bottom: 1px solid #ddd;
              position: sticky;
              top: 0;
              z-index: 1000;
              padding: 0 1rem;
          }
          .yt-nav .left-section {
              display: flex;
              align-items: center;
              gap: 1rem;
          }
          .yt-nav .brand {
              font-size: 1.3rem;
              font-weight: 600;
              color: var(--yt-red);
              text-decoration: none;
          }
          .yt-nav .search-form {
              display: flex;
              align-items: center;
              margin: 0 1rem;
          }
          .yt-nav .search-form input {
              width: 300px;
              border: 1px solid #ccc;
              border-right: none;
              border-radius: 2px 0 0 2px;
              padding: 6px;
              outline: none;
          }
          .yt-nav .search-form button {
              background: #f8f8f8;
              border: 1px solid #ccc;
              border-left: none;
              border-radius: 0 2px 2px 0;
              padding: 6px 12px;
          }
          .yt-nav .right-section {
              display: flex;
              align-items: center;
              gap: 1rem;
          }
          .yt-nav a.nav-link {
              color: #555;
              text-decoration: none;
          }
          /* Sidebar */
          .yt-sidebar {
              width: 240px;
              background: #fff;
              height: calc(100vh - 56px);
              overflow-y: auto;
              border-right: 1px solid #ddd;
              position: fixed;
              top: 56px;
              left: 0;
              transition: transform 0.3s ease;
              padding-top: 1rem;
          }
          .yt-sidebar.hide {
              transform: translateX(-240px);
          }
          .yt-sidebar .sidebar-item {
              display: flex;
              align-items: center;
              padding: 10px 20px;
              color: #333;
              cursor: pointer;
              transition: background 0.2s;
              text-decoration: none;
          }
          .yt-sidebar .sidebar-item:hover {
              background: var(--yt-hover);
          }
          .yt-sidebar .sidebar-item i {
              margin-right: 1rem;
              font-size: 1.2rem;
          }
          .yt-sidebar .sidebar-divider {
              border-top: 1px solid #ddd;
              margin: 8px 0;
          }
          /* Content area */
          .yt-content {
              margin-left: 240px;
              padding: 1rem;
              margin-top: 56px;
              transition: margin-left 0.3s ease;
          }
          /* For smaller screens */
          @media (max-width: 992px) {
              .yt-sidebar {
                  transform: translateX(-240px);
              }
              .yt-sidebar.show {
                  transform: translateX(0);
              }
              .yt-content {
                  margin-left: 0;
              }
          }
          /* Video cards grid */
          .video-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
              gap: 1rem;
          }
          .video-card {
              border: none;
              border-radius: 8px;
              overflow: hidden;
              background: #fff;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              transition: transform 0.2s;
          }
          .video-card:hover {
              transform: scale(1.02);
          }
          .video-thumbnail {
              width: 100%;
              height: 160px;
              object-fit: cover;
              border: none;
          }
          .video-card .card-body {
              padding: 8px;
          }
          .video-card .card-title {
              font-size: 1rem;
              margin-bottom: 0.2rem;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
          }
          .video-card .card-text {
              font-size: 0.9rem;
              color: #666;
              height: 2.5em;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: wrap;
          }
          /* Footer */
          footer {
              background: #f1f1f1;
              color: #333;
              padding: 1rem 0;
              text-align: center;
              margin-top: 2rem;
              border-top: 1px solid #ddd;
          }
          footer a {
              text-decoration: none;
              color: #333;
          }
          /* Notification toast */
          #notification {
              position: fixed;
              top: 70px;
              right: 20px;
              background: #333;
              color: #fff;
              padding: 8px 16px;
              border-radius: 4px;
              display: none;
              z-index: 9999;
          }
          /* Back to top button */
          #backToTop {
              position: fixed;
              bottom: 20px;
              right: 20px;
              display: none;
              z-index: 100;
              background: var(--yt-red);
              border: none;
              color: #fff;
              padding: 8px 16px;
              border-radius: 20px;
          }
          #backToTop:hover {
              background: #cc0000;
          }
          /* Buttons */
          .btn-primary,
          .button-animation {
              background: var(--yt-red) !important;
              border: none;
          }
          .btn-primary:hover,
          .button-animation:hover {
              background: #cc0000 !important;
          }
          /* Additional small styling */
          .preview-img {
              display: none;
              margin-top: 8px;
              max-width: 100%;
              border-radius: 6px;
          }
          /* Make forms, etc. adapt to smaller screens */
          @media (max-width: 576px) {
              .yt-nav .search-form input {
                  width: 140px;
              }
          }
      </style>
  </head>
  <body>
    <!-- Top Nav (like YouTube) -->
    <div class="yt-nav">
      <div class="left-section">
        <button id="menuBtn" class="btn btn-sm btn-light d-lg-none" style="border:1px solid #ccc;">
          <i class="bi bi-list"></i>
        </button>
        <a class="brand" href="/">MyTube</a>
      </div>
      <form class="search-form d-none d-md-flex" action="/search" method="GET">
        <input type="search" name="query" placeholder="Search" />
        <button type="submit"><i class="bi bi-search"></i></button>
      </form>
      <div class="right-section">
        ${
          req.session.userId
          ? `
            <a class="nav-link" href="/profile/${req.session.userId}">
              <i class="bi bi-person-circle"></i> Profile
            </a>
            <a class="nav-link" href="/logout">
              <i class="bi bi-box-arrow-right"></i> Logout
            </a>
          `
          : `
            <a class="nav-link" href="/login">
              <i class="bi bi-box-arrow-in-right"></i> Login
            </a>
            <a class="nav-link" href="/signup">
              <i class="bi bi-person-plus"></i> Sign Up
            </a>
          `
        }
      </div>
    </div>

    <!-- Sidebar (like YouTube's left menu) -->
    <div class="yt-sidebar hide" id="sidebar">
      <a class="sidebar-item" href="/"><i class="bi bi-house-door"></i> Home</a>
      <a class="sidebar-item" href="/music"><i class="bi bi-music-note-beamed"></i> Music</a>
      <a class="sidebar-item" href="/gaming"><i class="bi bi-controller"></i> Gaming</a>
      <a class="sidebar-item" href="/news"><i class="bi bi-newspaper"></i> News</a>
      <a class="sidebar-item" href="/general"><i class="bi bi-play-btn"></i> General</a>
      <div class="sidebar-divider"></div>
      ${
        req.session.userId
        ? `
          <a class="sidebar-item" href="/upload"><i class="bi bi-cloud-upload"></i> Upload</a>
          <a class="sidebar-item" href="/subscriptions"><i class="bi bi-collection-play"></i> Subscriptions</a>
        `
        : ''
      }
      ${
        req.session.isAdmin
        ? `<div class="sidebar-divider"></div>
           <a class="sidebar-item" href="/admin"><i class="bi bi-shield-lock"></i> Admin Panel</a>`
        : ''
      }
    </div>

    <!-- Notification -->
    <div id="notification"></div>

    <!-- Main Content Area -->
    <div class="yt-content" id="contentArea">
      ${content}
    </div>

    <footer>
      <p>© 2025 MyTube - Inspired by YouTube</p>
      <p>Created by <a href="https://www.facebook.com/villamor.gelera.5/">Villamor Gelera</a></p>
    </footer>

    <button id="backToTop"><i class="bi bi-arrow-up-short"></i></button>

    <!-- Scripts -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      // Socket.io notification listener
      var socket = io();
      socket.on('notification', function(message) {
        var notif = document.getElementById('notification');
        notif.innerText = message;
        notif.style.display = 'block';
        setTimeout(function() { notif.style.display = 'none'; }, 3000);
      });

      // Toggle sidebar on mobile
      const menuBtn = document.getElementById('menuBtn');
      const sidebar = document.getElementById('sidebar');
      if(menuBtn && sidebar) {
        menuBtn.addEventListener('click', () => {
          sidebar.classList.toggle('hide');
          sidebar.classList.toggle('show');
        });
      }

      // Close sidebar if a link is clicked on small screen
      document.querySelectorAll('.yt-sidebar .sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
          if(window.innerWidth < 992) {
            sidebar.classList.add('hide');
            sidebar.classList.remove('show');
          }
        });
      });

      // Back to top button
      const backToTopBtn = document.getElementById('backToTop');
      window.addEventListener('scroll', () => {
        if(window.scrollY > 400) {
          backToTopBtn.style.display = 'block';
        } else {
          backToTopBtn.style.display = 'none';
        }
      });
      backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // Thumbnail preview with mini autoplay on hover
      document.querySelectorAll('.video-thumbnail').forEach(img => {
        img.addEventListener('mouseenter', function() {
          const videoUrl = this.getAttribute('data-video');
          if(!videoUrl || videoUrl.endsWith('.png') || videoUrl.endsWith('.jpg')) return;
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
        // On mouse leave, restore the thumbnail
        img.addEventListener('mouseleave', function() {
          // If we've replaced it with a video, revert
          const parent = this.parentNode || this;
          const newVid = parent.querySelector('video');
          if(newVid) {
            const originalImg = document.createElement('img');
            originalImg.src = this.getAttribute('data-video-thumbnail') || this.src;
            originalImg.className = 'video-thumbnail';
            originalImg.style.width = newVid.width + 'px';
            originalImg.style.height = newVid.height + 'px';
            originalImg.setAttribute('data-video', this.getAttribute('data-video'));
            originalImg.setAttribute('data-video-thumbnail', this.getAttribute('data-video-thumbnail') || this.src);
            parent.replaceChild(originalImg, newVid);
          }
        });
      });

      // Preview images (like profile pics) before uploading
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
              previewEl.style.display = 'block';
            }
            reader.readAsDataURL(file);
          } else {
            previewEl.src = '';
            previewEl.style.display = 'none';
          }
        });
      }
      setupPreview('profilePicInput', 'profilePicPreview');
      setupPreview('backgroundPicInput', 'backgroundPicPreview');
      setupPreview('thumbnailFileInput', 'thumbnailFilePreview');

      // Web Share API for sharing
      function shareVideo(title) {
        if (navigator.share) {
          navigator.share({
            title: title,
            text: 'Check out this video!',
            url: window.location.href
          }).catch(err => console.log('Share canceled or failed: ', err));
        } else {
          alert('Sharing not supported in this browser. Copy this link: ' + window.location.href);
        }
      }

      // A small helper for "please login" scenarios
      function showLoginPrompt() {
        alert('Please log in to use this feature.');
      }
    </script>
  </body>
  </html>
  `;
}

// ========== HOME PAGE: LATEST, POPULAR & TRENDING ==========
app.get('/', async (req, res) => {
  try {
    let allVideos = await Video.find({}).populate('owner');
    let latestVideos = [...allVideos].sort((a, b) => b.uploadDate - a.uploadDate).slice(0, 6);
    let popularVideos = [...allVideos].sort((a, b) => b.likes.length - a.likes.length).slice(0, 6);
    let trendingVideos = [...allVideos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 6);

    let latestHtml = '<h4 class="mb-3">Latest Videos</h4><div class="video-grid">';
    latestVideos.forEach(video => {
      latestHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    latestHtml += '</div>';

    let popularHtml = '<h4 class="mt-4 mb-3">Popular Videos</h4><div class="video-grid">';
    popularVideos.forEach(video => {
      popularHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    popularHtml += '</div>';

    let trendingHtml = '<h4 class="mt-4 mb-3">Trending Videos</h4><div class="video-grid">';
    trendingVideos.forEach(video => {
      trendingHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    trendingHtml += '</div>';

    let combinedHtml = `
      <div class="container-fluid">
        ${latestHtml}
        ${popularHtml}
        ${trendingHtml}
      </div>
    `;
    res.send(renderPage(combinedHtml, req));
  } catch (err) {
    console.error('Error loading home videos:', err);
    res.send('Error loading videos.');
  }
});

// ========== SEARCH ROUTE ==========
app.get('/search', async (req, res) => {
  const q = req.query.query || '';
  try {
    let videos = await Video.find({
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } }
      ]
    });
    let searchHtml = `<h4 class="mb-3">Search Results for "${q}"</h4>`;
    if (videos.length === 0) {
      searchHtml += '<p>No videos found.</p>';
    } else {
      searchHtml += '<div class="video-grid">';
      videos.forEach(video => {
        searchHtml += `
          <div class="video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="video-thumbnail"
                 data-video="${video.filePath}"
                 data-video-thumbnail="${video.thumbnail}">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
                <i class="bi bi-play-circle"></i> Watch
              </a>
            </div>
          </div>
        `;
      });
      searchHtml += '</div>';
    }
    res.send(renderPage(`<div class="container-fluid">${searchHtml}</div>`, req));
  } catch (err) {
    res.send('Error searching videos.');
  }
});

// ========== CATEGORY ROUTES (Music, Gaming, News, General) ==========
app.get('/music', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'Music' });
    let videoHtml = `<h4 class="mb-3">Music Videos</h4><div class="video-grid">`;
    videos.forEach(video => {
      videoHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(`<div class="container-fluid">${videoHtml}</div>`, req));
  } catch (err) {
    res.send('Error loading music videos.');
  }
});

app.get('/gaming', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'Gaming' });
    let videoHtml = `<h4 class="mb-3">Gaming Videos</h4><div class="video-grid">`;
    videos.forEach(video => {
      videoHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(`<div class="container-fluid">${videoHtml}</div>`, req));
  } catch (err) {
    res.send('Error loading gaming videos.');
  }
});

app.get('/news', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'News' });
    let videoHtml = `<h4 class="mb-3">News Videos</h4><div class="video-grid">`;
    videos.forEach(video => {
      videoHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(`<div class="container-fluid">${videoHtml}</div>`, req));
  } catch (err) {
    res.send('Error loading news videos.');
  }
});

app.get('/general', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'General' });
    let videoHtml = `<h4 class="mb-3">General Videos</h4><div class="video-grid">`;
    videos.forEach(video => {
      videoHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(`<div class="container-fluid">${videoHtml}</div>`, req));
  } catch (err) {
    res.send('Error loading general videos.');
  }
});

// ========== AUTHENTICATION ==========
app.get('/signup', (req, res) => {
  const form = `
  <div class="container" style="margin-top:80px;">
    <h4 class="mb-3">Sign Up</h4>
    <form method="POST" action="/signup">
      <div class="mb-3">
        <label>Username:</label>
        <input type="text" name="username" class="form-control" required />
      </div>
      <div class="mb-3">
        <label>Email:</label>
        <input type="email" name="email" class="form-control" required />
      </div>
      <div class="mb-3">
        <label>Password:</label>
        <input type="password" name="password" class="form-control" required />
      </div>
      <button type="submit" class="btn btn-primary button-animation">Sign Up</button>
    </form>
  </div>
  `;
  res.send(renderPage(form, req));
});

app.post('/signup', async (req, res) => {
  let { username, email, password } = req.body;
  username = (username || '').trim().toLowerCase();
  email    = (email || '').trim().toLowerCase();
  if(!username || !password || !email) {
    return res.send('Error signing up. All fields (username, email, password) are required.');
  }
  try {
    let existingUser = await User.findOne({ username });
    if(existingUser) {
      return res.send('Error signing up. Username already taken.');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword
    });
    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    console.error('Error signing up:', err);
    if (err.code === 11000) {
      return res.send('Duplicate key error. Possibly the username or email is already in use.');
    }
    res.send('Error signing up.');
  }
});

app.get('/login', (req, res) => {
  const form = `
  <div class="container" style="margin-top:80px;">
    <h4 class="mb-3">Login</h4>
    <form method="POST" action="/login">
      <div class="mb-3">
        <label>Username:</label>
        <input type="text" name="username" class="form-control" required />
      </div>
      <div class="mb-3">
        <label>Password:</label>
        <input type="password" name="password" class="form-control" required />
      </div>
      <button type="submit" class="btn btn-primary button-animation">Login</button>
    </form>
  </div>
  `;
  res.send(renderPage(form, req));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username: (username || '').trim().toLowerCase() });
    if (!user) return res.send('Invalid username or password.');
    if (user.banned) return res.send('Your account has been banned.');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid username or password.');
    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
    req.session.profilePic = user.profilePic;
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
  const form = `
  <div class="container" style="margin-top:80px;">
    <h4 class="mb-3">Upload Video</h4>
    <form method="POST" action="/upload" enctype="multipart/form-data">
      <div class="mb-3">
        <label>Title:</label>
        <input type="text" name="title" class="form-control" required />
      </div>
      <div class="mb-3">
        <label>Description:</label>
        <textarea name="description" class="form-control" rows="4" required></textarea>
      </div>
      <div class="mb-3">
        <label>Category:</label>
        <select name="category" class="form-control">
          <option value="Music">Music</option>
          <option value="Gaming">Gaming</option>
          <option value="News">News</option>
          <option value="General" selected>General</option>
        </select>
      </div>
      <div class="mb-3">
        <label>Video File:</label>
        <input type="file" name="videoFile" class="form-control" accept="video/*" required />
      </div>
      <div class="mb-3">
        <label>Thumbnail (optional):</label>
        <input type="file" name="thumbnailFile" class="form-control" accept="image/*" id="thumbnailFileInput"/>
        <img id="thumbnailFilePreview" class="preview-img" alt="Thumbnail Preview" />
      </div>
      <button type="submit" class="btn btn-primary button-animation">Upload</button>
    </form>
  </div>
  `;
  res.send(renderPage(form, req));
});

app.post('/upload', isAuthenticated, async (req, res) => {
  try {
    if (!req.files || !req.files.videoFile) {
      return res.send('No video file uploaded.');
    }
    let videoFile = req.files.videoFile;
    let videoResult = await cloudinary.uploader.upload(videoFile.tempFilePath, {
      resource_type: 'video',
      folder: 'videos'
    });
    let filePath = videoResult.secure_url;

    let thumbnailPath;
    if (req.files.thumbnailFile) {
      let thumbFile = req.files.thumbnailFile;
      let thumbResult = await cloudinary.uploader.upload(thumbFile.tempFilePath, {
        resource_type: 'image',
        folder: 'thumbnails'
      });
      thumbnailPath = thumbResult.secure_url;
    } else {
      thumbnailPath = cloudinary.url(videoResult.public_id + '.png', {
        resource_type: 'video',
        format: 'png',
        transformation: [{ width: 320, height: 240, crop: 'fill' }]
      });
    }

    let newVideo = new Video({
      title:       req.body.title,
      description: req.body.description,
      filePath:    filePath,
      thumbnail:   thumbnailPath,
      category:    req.body.category || 'General',
      owner:       req.session.userId
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

    let suggested = await Video.find({
      category: video.category,
      _id: { $ne: video._id }
    }).limit(5);

    let suggestedHtml = '';
    suggested.forEach(sv => {
      suggestedHtml += `
      <div class="card mb-2">
        <div class="card-body p-2">
          <img src="${sv.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${sv.filePath}"
               data-video-thumbnail="${sv.thumbnail}"
               style="width:100%; max-height:100px; object-fit:cover; border-radius:5px;">
          <p class="mt-2"><strong>${sv.title}</strong></p>
          <a href="/video/${sv._id}" class="btn btn-sm btn-primary button-animation"><i class="bi bi-play-circle"></i> Watch</a>
        </div>
      </div>
      `;
    });

    let subscribeButton = '';
    if (req.session.userId) {
      if(req.session.userId !== video.owner._id.toString()) {
        let isSubscribed = video.owner.subscribers.includes(req.session.userId);
        subscribeButton = `
        <form method="POST" action="/subscribe/${video.owner._id}" style="display:inline;">
          <button class="btn btn-info button-animation me-2" type="submit">
            ${isSubscribed ? 'Unsubscribe' : 'Subscribe'}
          </button>
        </form>
        `;
      }
    } else {
      subscribeButton = `<button class="btn btn-info button-animation me-2" onclick="showLoginPrompt()">Subscribe</button>`;
    }

    let downloadButton = '';
    if (req.session.userId) {
      downloadButton = `<a href="/download/${video._id}" class="btn btn-secondary button-animation me-2"><i class="bi bi-download"></i> Download</a>`;
    } else {
      downloadButton = `<button class="btn btn-secondary button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-download"></i> Download</button>`;
    }

    let likeBtn = '';
    if (req.session.userId) {
      likeBtn = `
        <form method="POST" action="/like/${video._id}" style="display:inline;">
          <button class="btn btn-success button-animation me-2" type="submit">
            <i class="bi bi-hand-thumbs-up"></i> Like (${video.likes.length})
          </button>
        </form>
      `;
    } else {
      likeBtn = `<button class="btn btn-success button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-hand-thumbs-up"></i> Like (${video.likes.length})</button>`;
    }

    let dislikeBtn = '';
    if (req.session.userId) {
      dislikeBtn = `
        <form method="POST" action="/dislike/${video._id}" style="display:inline;">
          <button class="btn btn-warning button-animation me-2" type="submit">
            <i class="bi bi-hand-thumbs-down"></i> Dislike (${video.dislikes.length})
          </button>
        </form>
      `;
    } else {
      dislikeBtn = `<button class="btn btn-warning button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-hand-thumbs-down"></i> Dislike (${video.dislikes.length})</button>`;
    }

    let editDelete = '';
    if (req.session.userId && video.owner._id.toString() === req.session.userId) {
      editDelete = `
        <a href="/edit/${video._id}" class="btn btn-secondary button-animation me-2">
          <i class="bi bi-pencil"></i> Edit
        </a>
        <form method="POST" action="/delete/${video._id}" style="display:inline;">
          <button type="submit" class="btn btn-danger button-animation me-2">
            <i class="bi bi-trash"></i> Delete
          </button>
        </form>
      `;
    }

    let shareButton = '';
    if (req.session.userId) {
      shareButton = `
        <button class="btn btn-outline-primary button-animation me-2" onclick="shareVideo('${video.title}')">
          <i class="bi bi-share"></i> Share
        </button>
      `;
    } else {
      shareButton = `<button class="btn btn-outline-primary button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-share"></i> Share</button>`;
    }

    let commentForm = '';
    if (req.session.userId) {
      commentForm = `
        <form method="POST" action="/comment/${video._id}" class="mt-3">
          <div class="mb-2">
            <textarea name="comment" class="form-control" placeholder="Add a comment..." required></textarea>
          </div>
          <button type="submit" class="btn btn-primary button-animation"><i class="bi bi-chat-right-text"></i> Comment</button>
        </form>
      `;
    } else {
      commentForm = `<button class="btn btn-primary button-animation mt-3" onclick="showLoginPrompt()"><i class="bi bi-chat-right-text"></i> Log in to comment</button>`;
    }

    let commentsHtml = '';
    video.comments.forEach(c => {
      commentsHtml += `<p><strong>${c.user.username}:</strong> ${c.comment}</p>`;
    });

    let reportForm = '';
    if (req.session.userId) {
      reportForm = `
      <form method="POST" action="/report/${video._id}" class="mt-4">
        <div class="mb-2">
          <input type="text" name="reason" class="form-control" placeholder="Reason for report" required />
        </div>
        <button type="submit" class="btn btn-danger button-animation">
          <i class="bi bi-flag"></i> Report
        </button>
      </form>
      `;
    } else {
      reportForm = `<button class="btn btn-danger button-animation mt-4" onclick="showLoginPrompt()"><i class="bi bi-flag"></i> Report</button>`;
    }

    let videoPage = `
      <div class="container" style="margin-top:80px;">
        <div class="row">
          <div class="col-md-8">
            <h3>${video.title}</h3>
            <div class="mb-3">
              <label for="videoQuality" class="form-label">Video Quality:</label>
              <select id="videoQuality" class="form-select" style="max-width: 150px;">
                <option value="360">360p</option>
                <option value="480">480p</option>
                <option value="720" selected>720p</option>
                <option value="1080">1080p</option>
              </select>
            </div>
            <video id="videoPlayer" width="100%" height="auto" controls data-original-src="${video.filePath}">
              <source src="${video.filePath}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
            <p class="mt-2">Category: ${video.category}</p>
            <p style="white-space: pre-wrap;">${autoLink(video.description)}</p>
            <p>Uploaded by: <a href="/profile/${video.owner._id}">${video.owner.username}</a></p>
            ${subscribeButton}
            ${likeBtn} 
            ${dislikeBtn} 
            ${editDelete} 
            ${downloadButton} 
            ${shareButton}
            <hr>
            <h5>Comments</h5>
            ${commentsHtml}
            ${commentForm}
            <hr>
            <h5>Report this Video</h5>
            ${reportForm}
          </div>
          <div class="col-md-4">
            <h5>Suggested Videos</h5>
            ${suggestedHtml}
          </div>
        </div>
      </div>
    `;
    res.send(renderPage(videoPage, req));
  } catch (err) {
    console.error('View video error:', err);
    res.send('Error retrieving video.');
  }
});

app.post('/like/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id).populate('owner');
    if (!video) return res.send('Video not found.');
    let user = await User.findById(req.session.userId);
    video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    if (video.likes.includes(req.session.userId)) {
      video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      video.likes.push(req.session.userId);
      io.emit('notification', `${user.username} liked the video "${video.title}" by ${video.owner ? video.owner.username : 'Unknown'}`);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error liking video.');
  }
});

app.post('/dislike/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id).populate('owner');
    if (!video) return res.send('Video not found.');
    let user = await User.findById(req.session.userId);
    video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    if (video.dislikes.includes(req.session.userId)) {
      video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      video.dislikes.push(req.session.userId);
      io.emit('notification', `${user.username} disliked the video "${video.title}" by ${video.owner ? video.owner.username : 'Unknown'}`);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error disliking video.');
  }
});

app.post('/comment/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.comments.push({ user: req.session.userId, comment: req.body.comment });
    await video.save();
    io.emit('notification', 'New comment added!');
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error commenting on video.');
  }
});

app.post('/report/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.reports.push({
      user: req.session.userId,
      reason: req.body.reason
    });
    await video.save();
    io.emit('notification', 'A video has been reported!');
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error reporting video.');
  }
});

app.get('/edit/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    const form = `
    <div class="container" style="margin-top:80px;">
      <h4 class="mb-3">Edit Video</h4>
      <form method="POST" action="/edit/${video._id}" enctype="multipart/form-data">
        <div class="mb-3">
          <label>Title:</label>
          <input type="text" name="title" class="form-control" value="${video.title}" required />
        </div>
        <div class="mb-3">
          <label>Description:</label>
          <textarea name="description" class="form-control" rows="4" required>${video.description}</textarea>
        </div>
        <div class="mb-3">
          <label>Category:</label>
          <select name="category" class="form-control">
            <option value="Music" ${video.category === 'Music' ? 'selected' : ''}>Music</option>
            <option value="Gaming" ${video.category === 'Gaming' ? 'selected' : ''}>Gaming</option>
            <option value="News" ${video.category === 'News' ? 'selected' : ''}>News</option>
            <option value="General" ${video.category === 'General' ? 'selected' : ''}>General</option>
          </select>
        </div>
        <div class="mb-3">
          <label>Change Thumbnail (optional):</label>
          <input type="file" name="thumbnailFile" class="form-control" accept="image/*" id="thumbnailFileInput" />
          <img id="thumbnailFilePreview" class="preview-img" alt="Thumbnail Preview" />
        </div>
        <button type="submit" class="btn btn-primary button-animation">Update</button>
      </form>
    </div>
    `;
    res.send(renderPage(form, req));
  } catch (err) {
    res.send('Error editing video.');
  }
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    video.title       = req.body.title;
    video.description = req.body.description;
    video.category    = req.body.category || 'General';

    if (req.files && req.files.thumbnailFile) {
      let thumbFile = req.files.thumbnailFile;
      let thumbResult = await cloudinary.uploader.upload(thumbFile.tempFilePath, {
        resource_type: 'image',
        folder: 'thumbnails'
      });
      video.thumbnail = thumbResult.secure_url;
    }

    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error updating video.');
  }
});

app.post('/delete/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    await Video.deleteOne({ _id: req.params.id });
    res.redirect('/');
  } catch (err) {
    res.send('Error deleting video.');
  }
});

app.get('/download/:id', async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    res.redirect(video.filePath);
  } catch (err) {
    console.error('Download error:', err);
    res.send('Error downloading file.');
  }
});

// ========== SUBSCRIBE / UNSUBSCRIBE ==========
app.post('/subscribe/:ownerId', isAuthenticated, async (req, res) => {
  try {
    let owner = await User.findById(req.params.ownerId);
    let user  = await User.findById(req.session.userId);
    if (!owner || !user) return res.send('User not found.');
    if (owner._id.toString() === user._id.toString()) {
      return res.send('You cannot subscribe to yourself.');
    }
    let alreadySubscribed = owner.subscribers.includes(user._id);
    if (alreadySubscribed) {
      owner.subscribers = owner.subscribers.filter(sid => sid.toString() !== user._id.toString());
    } else {
      owner.subscribers.push(user._id);
    }
    await owner.save();
    io.emit(
      'notification',
      user.username + (alreadySubscribed ? ' unsubscribed from ' : ' subscribed to ') + owner.username
    );
    res.redirect('back');
  } catch (err) {
    res.send('Error subscribing/unsubscribing.');
  }
});

app.get('/subscriptions', isAuthenticated, async (req, res) => {
  try {
    let subscriptions = await User.find({ subscribers: req.session.userId });
    let subsHtml = `<h4 class="mb-3">Your Subscriptions</h4><div class="row">`;
    subscriptions.forEach(sub => {
      subsHtml += `
        <div class="col-md-3">
          <div class="card mb-2">
            <img src="${sub.profilePic}" alt="Profile Pic" class="card-img-top" style="height:120px; object-fit:cover; border:none;">
            <div class="card-body">
              <h6 class="card-title">${sub.username}</h6>
              <a href="/profile/${sub._id}" class="btn btn-primary button-animation btn-sm">View Profile</a>
            </div>
          </div>
        </div>
      `;
    });
    subsHtml += `</div>`;
    res.send(renderPage(`<div class="container" style="margin-top:80px;">${subsHtml}</div>`, req));
  } catch(err) {
    res.send('Error loading subscriptions.');
  }
});

// ========== USER PROFILE ==========
app.get('/profile/:id', async (req, res) => {
  try {
    let userProfile = await User.findById(req.params.id);
    if (!userProfile) return res.send('User not found.');
    let videos = await Video.find({ owner: req.params.id });

    let videosHtml = '<div class="video-grid">';
    videos.forEach(video => {
      videosHtml += `
        <div class="video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="video-thumbnail"
               data-video="${video.filePath}"
               data-video-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
              <i class="bi bi-play-circle"></i> Watch
            </a>
          </div>
        </div>
      `;
    });
    videosHtml += '</div>';

    let profileHtml = `
    <div class="container" style="margin-top:80px;">
      <h4>${userProfile.username} ${userProfile.verified ? '<span class="badge bg-success">Verified</span>' : ''}</h4>
      <img src="${userProfile.profilePic}" alt="Profile Picture" style="width:120px;height:120px; object-fit:cover; border-radius:50%; border:none;">
      <p class="mt-2">${userProfile.about}</p>
      <p>Subscribers: ${userProfile.subscribers.length}</p>
    `;

    if(req.session.userId) {
      if(req.session.userId !== req.params.id) {
        let isSubscribed = userProfile.subscribers.includes(req.session.userId);
        profileHtml += `
        <form method="POST" action="/subscribe/${userProfile._id}" style="display:inline;">
          <button class="btn btn-info button-animation me-2" type="submit">
            ${isSubscribed ? 'Unsubscribe' : 'Subscribe'}
          </button>
        </form>
        `;
      } else {
        let subscriptionsList = await User.find({ subscribers: req.session.userId });
        if(subscriptionsList.length > 0) {
          profileHtml += `<h5 class="mt-4">Your Subscriptions:</h5><div class="row">`;
          subscriptionsList.forEach(sub => {
            profileHtml += `
              <div class="col-md-3">
                <div class="card mb-2">
                  <img src="${sub.profilePic}" alt="Profile Pic" class="card-img-top" style="height:120px; object-fit:cover; border:none;">
                  <div class="card-body">
                    <h6 class="card-title">${sub.username}</h6>
                    <a href="/profile/${sub._id}" class="btn btn-sm btn-primary button-animation">View</a>
                  </div>
                </div>
              </div>
            `;
          });
          profileHtml += `</div>`;
        }
      }
    } else {
      profileHtml += `<button class="btn btn-info button-animation me-2" onclick="showLoginPrompt()">Subscribe</button>`;
    }

    let popularVideos = [...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 3);
    if(popularVideos.length > 0) {
      profileHtml += `<h5 class="mt-4">Popular Videos by ${userProfile.username}:</h5><div class="video-grid mb-3">`;
      popularVideos.forEach(video => {
        profileHtml += `
          <div class="video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="video-thumbnail"
                 data-video="${video.filePath}"
                 data-video-thumbnail="${video.thumbnail}">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <a href="/video/${video._id}" class="btn btn-sm btn-primary button-animation me-2">
                <i class="bi bi-play-circle"></i> Watch
              </a>
            </div>
          </div>
        `;
      });
      profileHtml += `</div>`;
    }

    profileHtml += `<h5 class="mt-4">All Videos by ${userProfile.username}:</h5>${videosHtml}`;

    if(req.session.userId && req.session.userId === req.params.id) {
      profileHtml += `
      <hr>
      <h5>Update Profile</h5>
      <form method="POST" action="/updateProfile" enctype="multipart/form-data" class="mb-4">
        <div class="mb-3">
          <label>Profile Picture:</label>
          <input type="file" name="profilePic" accept="image/*" class="form-control" id="profilePicInput" />
          <img id="profilePicPreview" class="preview-img" alt="Profile Pic Preview" />
        </div>
        <div class="mb-3">
          <label>About Me:</label>
          <textarea name="about" class="form-control" rows="3">${userProfile.about}</textarea>
        </div>
        <button type="submit" class="btn btn-primary button-animation">Update Profile</button>
      </form>
      `;
      if (userProfile.warnings && userProfile.warnings.length > 0) {
        profileHtml += `<hr><h5>Your Warnings from Admin:</h5>`;
        userProfile.warnings.forEach(w => {
          profileHtml += `<p>- ${w.message} (on ${w.date.toLocaleString()})</p>`;
        });
      }
    }
    profileHtml += `</div>`;

    res.send(renderPage(profileHtml, req));
  } catch (err) {
    console.error('Profile error:', err);
    res.send('Error loading profile.');
  }
});

app.post('/updateProfile', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    if(req.files && req.files.profilePic) {
      let pic = req.files.profilePic;
      let picResult = await cloudinary.uploader.upload(pic.tempFilePath, {
        resource_type: 'image',
        folder: 'profiles'
      });
      user.profilePic = picResult.secure_url;
      req.session.profilePic = picResult.secure_url;
    }
    user.about = req.body.about;
    // We skip streamKey update to remove live stream features
    await user.save();
    res.redirect('/profile/' + req.session.userId);
  } catch (err) {
    console.error('Profile update error:', err);
    res.send('Error updating profile.');
  }
});

// ========== ADMIN PANEL ==========
app.get('/admin', isAdmin, async (req, res) => {
  try {
    let users = await User.find({});
    let userHtml = `<h4 class="mb-3">Admin Panel - Manage Users</h4>`;
    users.forEach(user => {
      userHtml += `
      <div class="card mb-2">
        <div class="card-body">
          <p>
            <strong>${user.username}</strong>
            - ${user.banned ? '<span class="text-danger">Banned</span>' : 'Active'}
            ${
              user._id.toString() !== req.session.userId
                ? `
                  <form style="display:inline;" method="POST" action="/ban/${user._id}">
                    <button class="btn btn-danger btn-sm button-animation me-2">Ban/Unban</button>
                  </form>
                  <form style="display:inline;" method="POST" action="/admin/delete/user/${user._id}">
                    <button class="btn btn-danger btn-sm button-animation me-2">Delete Account</button>
                  </form>
                  <form style="display:inline;" method="POST" action="/admin/warn/${user._id}">
                    <input type="text" name="message" placeholder="Warning reason" required />
                    <button class="btn btn-warning btn-sm button-animation me-2">Warn</button>
                  </form>
                `
                : ''
            }
            ${
              !user.verified
                ? `
                  <form style="display:inline;" method="POST" action="/verify/${user._id}">
                    <button class="btn btn-info btn-sm button-animation me-2">Verify</button>
                  </form>
                `
                : ''
            }
          </p>
        </div>
      </div>
      `;
    });

    let videos = await Video.find({}).populate('owner');
    let videoHtml = `<h4 class="mt-4 mb-3">Admin Panel - Manage Videos</h4>`;
    videos.forEach(video => {
      videoHtml += `
      <div class="card mb-2">
        <div class="card-body">
          <p>
            <strong>${video.title}</strong>
            by ${video.owner ? video.owner.username : 'Unknown'}
            <form style="display:inline;" method="POST" action="/admin/delete/video/${video._id}">
              <button class="btn btn-danger btn-sm button-animation me-2">Delete Video</button>
            </form>
          </p>
        </div>
      </div>
      `;
    });

    const panelHtml = `
      <div class="container" style="margin-top:80px;">
        ${userHtml}
        ${videoHtml}
      </div>
    `;
    res.send(renderPage(panelHtml, req));
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

app.post('/admin/warn/:id', isAdmin, async (req, res) => {
  try {
    let user = await User.findById(req.params.id);
    if(!user) return res.send('User not found.');
    user.warnings.push({ message: req.body.message });
    await user.save();
    io.emit('notification', 'Admin warned ' + user.username + ' for: ' + req.body.message);
    res.redirect('/admin');
  } catch (err) {
    console.error('Warn user error:', err);
    res.send('Error warning user.');
  }
});

app.post('/admin/delete/video/:id', isAdmin, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    await Video.deleteOne({ _id: req.params.id });
    res.redirect('/admin');
  } catch (err) {
    res.send('Error deleting video.');
  }
});

app.post('/admin/delete/user/:id', isAdmin, async (req, res) => {
  try {
    let user = await User.findById(req.params.id);
    if (!user) return res.send('User not found.');
    await User.deleteOne({ _id: req.params.id });
    res.redirect('/admin');
  } catch (err) {
    res.send('Error deleting user.');
  }
});

// ================== START SERVER ==================
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
