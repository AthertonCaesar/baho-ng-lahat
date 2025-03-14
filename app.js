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
  cloud_name: 'df0yc1cvr',
  api_key: '143758952799997',
  api_secret: 'a9TyH_t9lqZvem3cKkYSoXJ_6-E'
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
  .then(() => {
    console.log('MongoDB connected');
    // Drop the email index to fix signup error
    mongoose.connection.db.collection('users').dropIndex('email_1', (err, result) => {
      if (err) console.error('Error dropping email index:', err);
      else console.log('Dropped email index successfully');
    });
  })
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
  username:     { type: String, unique: true },
  password:     String,
  isAdmin:      { type: Boolean, default: false },
  banned:       { type: Boolean, default: false },
  verified:     { type: Boolean, default: false },
  subscribers:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  profilePic:   { type: String, default: 'https://via.placeholder.com/150/ffffff/000000?text=User' },
  backgroundPic:{ type: String, default: '/uploads/backgrounds/default.png' },
  about:        { type: String, default: '' },
  streamKey:    { type: String, default: '' }
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
  comments:    [{
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    comment: String,
    date:    { type: Date, default: Date.now }
  }],
  uploadDate:  { type: Date, default: Date.now },
  viewCount:   { type: Number, default: 0 }
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
        password: hashedPassword,
        isAdmin: true,
        verified: true
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

// ================== AUTO-LINK FUNCTION ==================
function autoLink(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}

// ================== HTML RENDERER (WITH SCRIPTS, SOCKET.IO & MODALS) ==================
function renderPage(content, req) {
  const isAdminUser = req.session.isAdmin || false;
  const username    = req.session.username || '';
  return `
  <!DOCTYPE html>
  <html>
  <head>
      <title>Baho ng Lahat</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <!-- Bootstrap 5 -->
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <!-- Bootstrap Icons -->
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
      <!-- Google Fonts -->
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
          :root {
              --primary: #00adb5;
              --primary-hover: #00838f;
              --dark: #222831;
              --light: #eeeeee;
          }
          body {
              background: var(--light);
              font-family: 'Inter', system-ui, -apple-system, sans-serif;
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              transition: background 0.3s ease, color 0.3s ease;
          }
          .navbar {
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          }
          .navbar .nav-link {
              margin-left: 10px;
          }
          .sidebar {
              height: calc(100vh - 56px);
              background: var(--light);
              border-right: 1px solid #dee2e6;
              padding-top: 1rem;
              transition: transform 0.3s ease;
          }
          .sidebar .nav-link {
              font-weight: 500;
              color: var(--dark);
              margin-bottom: 0.5rem;
              padding: 0.5rem 1rem;
              animation: fadeIn 0.5s ease-in-out;
          }
          .sidebar .nav-link:hover {
              color: var(--primary);
              background: rgba(0, 173, 181, 0.1);
              border-radius: 0.5rem;
          }
          .video-card {
              border: 0;
              border-radius: 12px;
              overflow: hidden;
              transition: transform 0.3s, box-shadow 0.3s;
              background: white;
          }
          .video-card:hover {
              transform: translateY(-5px);
              box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1);
          }
          .video-thumbnail {
              width: 100%;
              height: 200px;
              object-fit: cover;
              border-radius: 8px 8px 0 0;
          }
          .btn-primary {
              background: var(--primary);
              border: none;
              padding: 8px 16px;
              border-radius: 8px;
              transition: background 0.3s ease;
          }
          .btn-primary:hover {
              background: var(--primary-hover);
          }
          footer {
              background: var(--dark);
              color: white;
              margin-top: auto;
              padding: 2rem 0;
          }
          footer a img {
              filter: brightness(0) invert(1);
          }
          footer a {
              border: none;
              outline: none;
          }
          .preview-img {
              border-radius: 8px;
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
              margin: 1rem 0;
              max-width: 100%;
              transition: opacity 0.5s ease;
          }
          #backToTop {
              position: fixed;
              bottom: 20px;
              right: 20px;
              display: none;
              z-index: 100;
          }
          #notification {
              display: none;
              position: fixed;
              top: 20px;
              right: 20px;
              background: var(--primary);
              color: #fff;
              padding: 10px 15px;
              border-radius: 5px;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              z-index: 1050;
              animation: fadein 0.5s;
          }
          @keyframes fadein {
              from { opacity: 0; }
              to { opacity: 1; }
          }
          .button-animation {
              transition: transform 0.3s ease;
          }
          .button-animation:hover {
              transform: scale(1.05);
          }
          @media (max-width: 576px) {
              .user-actions {
                  flex-direction: column;
                  align-items: flex-start;
              }
              form.d-flex {
                  flex-direction: column;
                  gap: 5px;
              }
              .btn {
                  margin-bottom: 10px;
              }
          }
          @media (min-width: 768px) and (max-width: 991px) {
              .video-card {
                  margin-bottom: 1rem;
              }
              .video-thumbnail {
                  height: 150px;
              }
              .sidebar {
                  width: 180px;
              }
              .navbar .nav-link {
                  margin-left: 5px;
              }
          }
          .suggested-card {
              margin-bottom: 1rem;
              animation: fadeIn 0.5s ease-in-out;
          }
          @keyframes fadeIn {
              from { opacity: 0; transform: translateY(20px); }
              to { opacity: 1; transform: translateY(0); }
          }
          @media (max-width: 767.98px) {
              .sidebar {
                  position: absolute;
                  z-index: 1050;
                  width: 200px;
                  left: 0;
                  top: 56px;
                  background: var(--light);
                  border-right: 1px solid #dee2e6;
              }
              .navbar .nav-link { margin-left: 5px; }
          }
          @keyframes slideIn {
              from { transform: translateX(-100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
          }
          .slide-in {
              animation: slideIn 0.3s forwards;
          }
      </style>
  </head>
  <body>
      <!-- Top Navbar -->
      <nav class="navbar navbar-expand-lg sticky-top">
          <div class="container-fluid">
              <div class="d-flex align-items-center">
                  <button class="btn btn-outline-secondary d-md-none me-2" id="sidebarToggle">
                      <i class="bi bi-list"></i> Menu
                  </button>
                  <a class="navbar-brand fw-bold" href="/" style="color: var(--primary);">Baho ng Lahat</a>
              </div>
              <div class="d-flex align-items-center">
                  <form class="d-flex me-2" action="/search" method="GET">
                      <input class="form-control" type="search" name="query" placeholder="Search videos" aria-label="Search">
                      <button class="btn btn-outline-success ms-2 button-animation" type="submit">Search</button>
                  </form>
                  <!-- Profile picture removed, replaced with username or Guest -->
                  <span style="margin-right:10px;">${req.session.username || 'Guest'}</span>
                  ${
                    req.session.userId
                    ? ''
                    : `<a class="nav-link button-animation" href="/login">Login</a>
                       <a class="nav-link button-animation" href="/signup">Sign Up</a>`
                  }
              </div>
          </div>
      </nav>
      
      <div id="notification"></div>
      
      <div class="container-fluid">
          <div class="row">
              <!-- Sidebar Navigation -->
              <nav id="sidebar" class="col-md-2 d-none d-md-block sidebar">
                  <div class="position-sticky">
                      <ul class="nav flex-column">
                          <li class="nav-item"><a class="nav-link button-animation" href="/">Home</a></li>
                          <li class="nav-item"><a class="nav-link button-animation" href="/music">Music</a></li>
                          <li class="nav-item"><a class="nav-link button-animation" href="/gaming">Gaming</a></li>
                          <li class="nav-item"><a class="nav-link button-animation" href="/news">News</a></li>
                          <li class="nav-item"><a class="nav-link button-animation" href="/general">General</a></li>
                          ${
                            req.session.userId
                            ? `<li class="nav-item"><a class="nav-link button-animation" href="/upload">Upload Video</a></li>
                               <li class="nav-item"><a class="nav-link button-animation" href="/profile/${req.session.userId}">Profile</a></li>
                               <li class="nav-item"><a class="nav-link button-animation" href="/subscriptions">Subscriptions</a></li>
                               <li class="nav-item"><a class="nav-link button-animation" href="/logout">Logout</a></li>`
                            : ''
                          }
                          ${isAdminUser ? `<li class="nav-item"><a class="nav-link button-animation" href="/admin">Admin Panel</a></li>` : ''}
                      </ul>
                  </div>
              </nav>
              <!-- Main Content -->
              <main class="col-md-10 ms-sm-auto px-4">
                  ${content}
              </main>
          </div>
      </div>
      
      <footer class="text-center">
          <div class="container">
              <p class="mb-0">By Villamor Gelera</p>
              <div class="mt-2">
                  <a href="https://www.facebook.com/villamor.gelera.5/" class="me-2 button-animation">
                    <img src="https://img.icons8.com/ios-glyphs/24/ffffff/facebook-new.png" alt="Facebook"/>
                  </a>
                  <a href="https://www.instagram.com/villamor.gelera" class="button-animation">
                    <img src="https://img.icons8.com/ios-filled/24/ffffff/instagram-new.png" alt="Instagram"/>
                  </a>
              </div>
          </div>
      </footer>
  
      <button id="backToTop" class="btn btn-primary button-animation">Top</button>
  
      <!-- Bootstrap 5 JS -->
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      <!-- Socket.io -->
      <script src="/socket.io/socket.io.js"></script>
      <script>
        var socket = io();
        socket.on('notification', function(message) {
          var notif = document.getElementById('notification');
          notif.innerText = message;
          notif.style.display = 'block';
          setTimeout(function() { notif.style.display = 'none'; }, 3000);
        });

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

        function setupPreview(inputId, previewId) {
          const inputEl = document.getElementById(inputId);
          const previewEl = document.getElementById(previewId);
          if (!inputEl || !previewEl) return;
          previewEl.style.display = 'none';
          inputEl.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = function(e) {
                previewEl.src = e.target.result;
                previewEl.style.opacity = 0;
                previewEl.style.display = 'block';
                setTimeout(() => { previewEl.style.opacity = 1; }, 50);
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

        function shareVideo(title) {
          if (navigator.share) {
            navigator.share({
              title: title,
              text: 'Check out this video on Baho ng Lahat!',
              url: window.location.href
            }).catch(err => console.log('Share canceled or failed: ', err));
          } else {
            alert('Sharing not supported in this browser. Copy this link: ' + window.location.href);
          }
        }

        const backToTopBtn = document.getElementById('backToTop');
        window.addEventListener('scroll', () => {
          backToTopBtn.style.display = window.scrollY > 300 ? 'block' : 'none';
        });
        backToTopBtn.addEventListener('click', () => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if(sidebarToggle) {
          sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('d-none');
            if (!sidebar.classList.contains('d-none')) {
              sidebar.classList.add('slide-in');
              setTimeout(() => { sidebar.classList.remove('slide-in'); }, 300);
            }
          });
        }

        const qualityDropdown = document.getElementById('videoQuality');
        if(qualityDropdown) {
          qualityDropdown.addEventListener('change', function() {
            let quality = this.value;
            let videoPlayer = document.querySelector('video');
            console.log('Video quality changed to ' + quality + 'p');
          });
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
    let latestVideos = [...allVideos].sort((a, b) => b.uploadDate - a.uploadDate).slice(0, 5);
    let popularVideos = [...allVideos].sort((a, b) => b.likes.length - a.likes.length).slice(0, 5);
    let trendingVideos = [...allVideos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 5);

    let latestHtml = '<h3>Latest Videos</h3><div class="row">';
    latestVideos.forEach(video => {
      latestHtml += `
      <div class="col-md-4 col-12">
        <div class="card video-card mb-3">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail" data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Category: ${video.category}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
          </div>
        </div>
      </div>
      `;
    });
    latestHtml += '</div>';

    let popularHtml = '<h3 class="mt-4">Popular Videos</h3><div class="row">';
    popularVideos.forEach(video => {
      popularHtml += `
      <div class="col-md-4 col-12">
        <div class="card video-card mb-3">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail" data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Likes: ${video.likes.length}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
          </div>
        </div>
      </div>
      `;
    });
    popularHtml += '</div>';

    let trendingHtml = '<h3 class="mt-4">Trending Videos</h3><div class="row">';
    trendingVideos.forEach(video => {
      trendingHtml += `
      <div class="col-md-4 col-12">
        <div class="card video-card mb-3">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail" data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Views: ${video.viewCount}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
          </div>
        </div>
      </div>
      `;
    });
    trendingHtml += '</div>';

    let combinedHtml = `${latestHtml} ${popularHtml} ${trendingHtml}`;
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
    let searchHtml = `<h2>Search Results for "${q}"</h2>`;
    if (videos.length === 0) {
      searchHtml += '<p>No videos found.</p>';
    } else {
      searchHtml += '<div class="row">';
      videos.forEach(video => {
        searchHtml += `
        <div class="col-md-4 col-12">
          <div class="card video-card mb-3">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail" data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
            </div>
          </div>
        </div>
        `;
      });
      searchHtml += '</div>';
    }
    res.send(renderPage(searchHtml, req));
  } catch (err) {
    res.send('Error searching videos.');
  }
});

// ========== CATEGORY ROUTES (Music, Gaming, News, General) ==========
app.get('/music', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'Music' });
    let videoHtml = '<h2>Music Videos</h2><div class="row">';
    videos.forEach(video => {
      videoHtml += `
        <div class="col-md-4 col-12">
          <div class="card video-card mb-3">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail" data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
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
      videoHtml += `
        <div class="col-md-4 col-12">
          <div class="card video-card mb-3">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail" data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
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
      videoHtml += `
        <div class="col-md-4 col-12">
          <div class="card video-card mb-3">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail" data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
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
      videoHtml += `
        <div class="col-md-4 col-12">
          <div class="card video-card mb-3">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail" data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
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

// ========== AUTHENTICATION ==========
// Signup
app.get('/signup', (req, res) => {
  const form = `
  <h2>Sign Up</h2>
  <form method="POST" action="/signup">
    <div class="form-group mb-3">
      <label>Username:</label>
      <input type="text" name="username" class="form-control" required />
    </div>
    <div class="form-group mb-3">
      <label>Password:</label>
      <input type="password" name="password" class="form-control" required />
    </div>
    <button type="submit" class="btn btn-primary button-animation">Sign Up</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

app.post('/signup', async (req, res) => {
  let { username, password } = req.body;
  username = username.trim().toLowerCase();
  if (!username || !password) {
    return res.send('Error signing up. All fields are required.');
  }
  try {
    let existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.send('Error signing up. Username already taken.');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    console.error('Error signing up:', err);
    res.send('Error signing up. Please try again.');
  }
});

// Login
app.get('/login', (req, res) => {
  const form = `
  <h2>Login</h2>
  <form method="POST" action="/login">
    <div class="form-group mb-3">
      <label>Username:</label>
      <input type="text" name="username" class="form-control" required />
    </div>
    <div class="form-group mb-3">
      <label>Password:</label>
      <input type="password" name="password" class="form-control" required />
    </div>
    <button type="submit" class="btn btn-primary button-animation">Login</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user) return res.send('Invalid username or password.');
    if (user.banned) return res.send('Your account has been banned.');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid username or password.');
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin = user.isAdmin;
    req.session.profilePic = user.profilePic;
    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.send('Error logging in.');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ========== VIDEO ROUTES ==========
// Upload Video (GET)
app.get('/upload', isAuthenticated, (req, res) => {
  const form = `
  <h2>Upload Video</h2>
  <form method="POST" action="/upload" enctype="multipart/form-data">
    <div class="form-group mb-3">
      <label>Title:</label>
      <input type="text" name="title" class="form-control" required />
    </div>
    <div class="form-group mb-3">
      <label>Description:</label>
      <textarea name="description" class="form-control" required></textarea>
    </div>
    <div class="form-group mb-3">
      <label>Category:</label>
      <select name="category" class="form-control">
        <option value="Music">Music</option>
        <option value="Gaming">Gaming</option>
        <option value="News">News</option>
        <option value="General" selected>General</option>
      </select>
    </div>
    <div class="form-group mb-3">
      <label>Video File:</label>
      <input type="file" name="videoFile" class="form-control-file" accept="video/*" required />
    </div>
    <div class="form-group mb-3">
      <label>Thumbnail (optional):</label>
      <input type="file" name="thumbnailFile" class="form-control-file" accept="image/*" id="thumbnailFileInput"/>
      <img id="thumbnailFilePreview" class="preview-img" alt="Thumbnail Preview" />
    </div>
    <button type="submit" class="btn btn-primary button-animation">Upload</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

// Upload Video (POST)
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
      title: req.body.title,
      description: req.body.description,
      filePath: filePath,
      thumbnail: thumbnailPath,
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

// View Video and Actions
app.get('/video/:id', async (req, res) => {
  try {
    let video = await Video.findById(req.params.id).populate('owner').populate('comments.user');
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
      <div class="card suggested-card">
        <div class="card-body p-2">
          <img src="${sv.thumbnail}" alt="Thumbnail"
               class="video-thumbnail" data-video="${sv.filePath}"
               style="width:100%; max-height:100px; object-fit:cover; border-radius:5px;">
          <p class="mt-1 mb-1"><strong>${sv.title}</strong></p>
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
          <button class="btn btn-info button-animation me-2" type="submit">${isSubscribed ? 'Unsubscribe' : 'Subscribe'}</button>
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
          <button class="btn btn-success button-animation me-2" type="submit"><i class="bi bi-hand-thumbs-up"></i> Like (${video.likes.length})</button>
        </form>`;
    } else {
      likeBtn = `<button class="btn btn-success button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-hand-thumbs-up"></i> Like (${video.likes.length})</button>`;
    }
    let dislikeBtn = '';
    if (req.session.userId) {
      dislikeBtn = `
        <form method="POST" action="/dislike/${video._id}" style="display:inline;">
          <button class="btn btn-warning button-animation me-2" type="submit"><i class="bi bi-hand-thumbs-down"></i> Dislike (${video.dislikes.length})</button>
        </form>`;
    } else {
      dislikeBtn = `<button class="btn btn-warning button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-hand-thumbs-down"></i> Dislike (${video.dislikes.length})</button>`;
    }
    let editDelete = '';
    if (req.session.userId && video.owner._id.toString() === req.session.userId) {
      editDelete = `
        <a href="/edit/${video._id}" class="btn btn-secondary button-animation me-2"><i class="bi bi-pencil"></i> Edit</a>
        <form method="POST" action="/delete/${video._id}" style="display:inline;">
          <button type="submit" class="btn btn-danger button-animation me-2"><i class="bi bi-trash"></i> Delete</button>
        </form>
      `;
    }
    let shareButton = '';
    if (req.session.userId) {
      shareButton = `<button class="btn btn-outline-primary button-animation me-2" onclick="shareVideo('${video.title}')"><i class="bi bi-share"></i> Share</button>`;
    } else {
      shareButton = `<button class="btn btn-outline-primary button-animation me-2" onclick="showLoginPrompt()"><i class="bi bi-share"></i> Share</button>`;
    }
    let commentForm = '';
    if (req.session.userId) {
      commentForm = `
        <form method="POST" action="/comment/${video._id}">
          <div class="form-group mb-3">
            <textarea name="comment" class="form-control" placeholder="Add a comment..." required></textarea>
          </div>
          <button type="submit" class="btn btn-primary button-animation mt-3">Comment</button>
        </form>
      `;
    } else {
      commentForm = `<button class="btn btn-primary button-animation" onclick="showLoginPrompt()">Log in to comment</button>`;
    }
    let commentsHtml = '';
    video.comments.forEach(c => {
      commentsHtml += `<p><strong>${c.user.username}:</strong> ${c.comment}</p>`;
    });
    let videoPage = `
      <div class="row">
        <div class="col-md-8 col-12">
          <h2>${video.title}</h2>
          <div class="mb-2">
            <label for="videoQuality" class="form-label">Video Quality:</label>
            <select id="videoQuality" class="form-select" style="max-width: 150px;">
              <option value="360">360p</option>
              <option value="480">480p</option>
              <option value="720" selected>720p</option>
              <option value="1080">1080p</option>
            </select>
          </div>
          <video width="100%" height="auto" controls>
            <source src="${video.filePath}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
          <p>Category: ${video.category}</p>
          <p style="white-space: pre-wrap;">${autoLink(video.description)}</p>
          <p>Uploaded by: <a href="/profile/${video.owner._id}">${video.owner.username}</a></p>
          ${subscribeButton}
          ${likeBtn} ${dislikeBtn} ${editDelete} ${downloadButton} ${shareButton}
          <hr>
          <h4>Comments</h4>
          ${commentsHtml}
          ${req.session.userId ? commentForm : '<p>Please log in to comment.</p>'}
        </div>
        <div class="col-md-4 col-12">
          <h4>Suggested Videos</h4>
          ${suggestedHtml}
        </div>
      </div>
    `;
    res.send(renderPage(videoPage, req));
  } catch (err) {
    console.error('View video error:', err);
    res.send('Error retrieving video.');
  }
});

// Like Video
app.post('/like/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    if (video.likes.includes(req.session.userId)) {
      video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      video.likes.push(req.session.userId);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error liking video.');
  }
});

// Dislike Video
app.post('/dislike/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    if (video.dislikes.includes(req.session.userId)) {
      video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      video.dislikes.push(req.session.userId);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error disliking video.');
  }
});

// Comment on Video
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

// Edit Video (only owner)
app.get('/edit/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    const form = `
    <h2>Edit Video</h2>
    <form method="POST" action="/edit/${video._id}" enctype="multipart/form-data">
      <div class="form-group mb-3">
        <label>Title:</label>
        <input type="text" name="title" class="form-control" value="${video.title}" required />
      </div>
      <div class="form-group mb-3">
        <label>Description:</label>
        <textarea name="description" class="form-control" required>${video.description}</textarea>
      </div>
      <div class="form-group mb-3">
        <label>Category:</label>
        <select name="category" class="form-control">
          <option value="Music" ${video.category === 'Music' ? 'selected' : ''}>Music</option>
          <option value="Gaming" ${video.category === 'Gaming' ? 'selected' : ''}>Gaming</option>
          <option value="News" ${video.category === 'News' ? 'selected' : ''}>News</option>
          <option value="General" ${video.category === 'General' ? 'selected' : ''}>General</option>
        </select>
      </div>
      <div class="form-group mb-3">
        <label>Change Thumbnail (optional):</label>
        <input type="file" name="thumbnailFile" class="form-control-file" accept="image/*" id="thumbnailFileInput" />
        <img id="thumbnailFilePreview" class="preview-img" alt="Thumbnail Preview" />
      </div>
      <button type="submit" class="btn btn-primary button-animation">Update</button>
    </form>
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
    video.title = req.body.title;
    video.description = req.body.description;
    video.category = req.body.category || 'General';
    if (req.files && req.files.thumbnailFile) {
      let thumbFile = req.files.thumbnailFile;
      let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', Date.now() + '-' + thumbFile.name);
      await thumbFile.mv(thumbUploadPath);
      video.thumbnail = '/uploads/thumbnails/' + path.basename(thumbUploadPath);
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error updating video.');
  }
});

// Delete Video (only owner)
app.post('/delete/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    fs.unlink(path.join(__dirname, video.filePath), err => {
      if(err) console.log('Error deleting video file:', err);
    });
    await Video.deleteOne({ _id: req.params.id });
    res.redirect('/');
  } catch (err) {
    res.send('Error deleting video.');
  }
});

// ========== DOWNLOAD FEATURE ==========
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
    let user = await User.findById(req.session.userId);
    if (!owner || !user) return res.send('User not found.');
    if (owner._id.toString() === user._id.toString()) {
      return res.send('You cannot subscribe to yourself.');
    }
    if (owner.subscribers.includes(user._id)) {
      owner.subscribers = owner.subscribers.filter(sid => sid.toString() !== user._id.toString());
    } else {
      owner.subscribers.push(user._id);
    }
    await owner.save();
    res.redirect('back');
  } catch (err) {
    res.send('Error subscribing/unsubscribing.');
  }
});

// ========== SUBSCRIPTIONS PAGE ==========
app.get('/subscriptions', isAuthenticated, async (req, res) => {
  try {
    let subscriptions = await User.find({ subscribers: req.session.userId });
    let subsHtml = `<h2>Your Subscriptions</h2><div class="row">`;
    subscriptions.forEach(sub => {
      subsHtml += `
        <div class="col-md-3 col-6">
          <div class="card mb-2">
            <img src="${sub.profilePic}" alt="Profile Pic" class="card-img-top" style="height:100px; object-fit:cover;">
            <div class="card-body">
              <h6 class="card-title">${sub.username}</h6>
              <a href="/profile/${sub._id}" class="btn btn-primary button-animation btn-sm">View Profile</a>
            </div>
          </div>
        </div>
      `;
    });
    subsHtml += `</div>`;
    res.send(renderPage(subsHtml, req));
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
    let videosHtml = '<div class="row">';
    videos.forEach(video => {
      videosHtml += `
        <div class="col-md-4 col-12">
          <div class="card video-card mb-3">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail" data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch Video</a>
            </div>
          </div>
        </div>
      `;
    });
    videosHtml += '</div>';

    let profileHtml = `
    <h2>${userProfile.username} ${userProfile.verified ? '<span class="badge bg-success">Verified</span>' : ''}</h2>
    <p>${userProfile.about}</p>
    <p>Subscribers: ${userProfile.subscribers.length}</p>
    `;
    if(req.session.userId) {
      if(req.session.userId !== req.params.id) {
        let isSubscribed = userProfile.subscribers.includes(req.session.userId);
        profileHtml += `
        <form method="POST" action="/subscribe/${userProfile._id}" style="display:inline;">
          <button class="btn btn-info button-animation me-2" type="submit">${isSubscribed ? 'Unsubscribe' : 'Subscribe'}</button>
        </form>
        `;
      } else {
        let subscriptionsList = await User.find({ subscribers: req.session.userId });
        if(subscriptionsList.length > 0) {
          profileHtml += `<h4>Your Subscriptions:</h4><div class="row">`;
          subscriptionsList.forEach(sub => {
            profileHtml += `
              <div class="col-md-3 col-6">
                 <div class="card mb-2">
                     <img src="${sub.profilePic}" alt="Profile Pic" class="card-img-top" style="height:100px; object-fit:cover;">
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
       profileHtml += `<h4>Popular Videos by ${userProfile.username}:</h4><div class="row">`;
       popularVideos.forEach(video => {
         profileHtml += `
           <div class="col-md-4 col-12">
             <div class="card video-card mb-3">
               <img src="${video.thumbnail}" alt="Thumbnail" class="card-img-top video-thumbnail" style="max-height:200px; object-fit:cover;">
               <div class="card-body">
                  <h5 class="card-title">${video.title}</h5>
                  <a href="/video/${video._id}" class="btn btn-primary button-animation me-2"><i class="bi bi-play-circle"></i> Watch</a>
               </div>
             </div>
           </div>
         `;
       });
       profileHtml += `</div>`;
    }
    profileHtml += `<h4 class="mt-4">All Videos by ${userProfile.username}:</h4>${videosHtml}`;

    if(req.session.userId && req.session.userId === req.params.id) {
      profileHtml += `
      <hr>
      <h3>Update Profile</h3>
      <form method="POST" action="/updateProfile" enctype="multipart/form-data">
        <div class="form-group mb-3">
          <label>Profile Picture:</label>
          <input type="file" name="profilePic" accept="image/*" class="form-control-file" id="profilePicInput" />
          <img id="profilePicPreview" class="preview-img" alt="Profile Pic Preview" />
        </div>
        <div class="form-group mb-3">
          <label>About Me:</label>
          <textarea name="about" class="form-control">${userProfile.about}</textarea>
        </div>
        <div class="form-group mb-3">
          <label>Stream Key (for streaming):</label>
          <input type="text" name="streamKey" class="form-control" value="${userProfile.streamKey}" placeholder="Enter your stream key here" />
        </div>
        <button type="submit" class="btn btn-primary button-animation">Update Profile</button>
      </form>
      `;
    }
    res.send(renderPage(profileHtml, req));
  } catch (err) {
    console.error('Profile error:', err);
    res.send('Error loading profile.');
  }
});

// Update Profile (including Stream Key)
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
    user.streamKey = req.body.streamKey || '';
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
    let userHtml = '<h2>Admin Panel - Manage Users</h2>';
    users.forEach(user => {
      userHtml += `
      <div class="card mb-2">
        <div class="card-body">
          <p>${user.username} - ${user.banned ? '<span class="text-danger">Banned</span>' : 'Active'}
             ${
               user._id.toString() !== req.session.userId
                 ? `<form style="display:inline;" method="POST" action="/ban/${user._id}">
                      <button class="btn btn-danger btn-sm button-animation me-2">Ban/Unban</button>
                    </form>
                    <form style="display:inline;" method="POST" action="/admin/delete/user/${user._id}">
                      <button class="btn btn-danger btn-sm button-animation me-2">Delete Account</button>
                    </form>`
                 : ''
             }
             ${
               !user.verified
                 ? `<form style="display:inline;" method="POST" action="/verify/${user._id}">
                      <button class="btn btn-info btn-sm button-animation me-2">Verify</button>
                    </form>`
                 : ''
             }
          </p>
        </div>
      </div>
      `;
    });
    let videos = await Video.find({}).populate('owner');
    let videoHtml = '<h2 class="mt-4">Admin Panel - Manage Videos</h2>';
    videos.forEach(video => {
      videoHtml += `
      <div class="card mb-2">
        <div class="card-body">
          <p>${video.title} by ${video.owner.username}
             <form style="display:inline;" method="POST" action="/admin/delete/video/${video._id}">
                <button class="btn btn-danger btn-sm button-animation me-2">Delete Video</button>
             </form>
          </p>
        </div>
      </div>
      `;
    });
    res.send(renderPage(userHtml + videoHtml, req));
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

app.post('/admin/delete/video/:id', isAdmin, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    fs.unlink(path.join(__dirname, video.filePath), err => { if(err) console.log(err); });
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

// Dummy route for stopping live stream (admin only)
app.post('/admin/stop/live/:id', isAdmin, async (req, res) => {
  res.send('Live stream stopped.');
});

// ================== START SERVER ==================
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
