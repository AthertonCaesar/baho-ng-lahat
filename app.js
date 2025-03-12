// app.js

// ================== DEPENDENCIES ==================
const express         = require('express');
const mongoose        = require('mongoose');
const bcrypt          = require('bcryptjs');
const session         = require('express-session');
const fileUpload      = require('express-fileupload');
const path            = require('path');
const fs              = require('fs');
const { v4: uuidv4 }  = require('uuid'); // For generating tokens/keys

// For auto-generating thumbnails (requires FFmpeg):
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
const userSchema = new mongoose.Schema({
  username:      { type: String, unique: true },
  email:         { type: String, unique: true },
  password:      String,
  isAdmin:       { type: Boolean, default: false },
  banned:        { type: Boolean, default: false },
  verified:      { type: Boolean, default: false }, // legacy from earlier
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
  uploadDate:  { type: Date, default: Date.now }
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

// ================== HTML RENDERER (with custom styling) ==================
function renderPage(content, req) {
  const isAdminUser = req.session.isAdmin || false;
  const username    = req.session.username || '';
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Baho ng Lahat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Favicon (update path if needed) -->
    <link rel="icon" href="/uploads/logo.png" type="image/png">
    <!-- Google Font -->
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap" rel="stylesheet">
    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <style>
      body {
        background: linear-gradient(to right, #fafafa, #e3e3e3);
        font-family: 'Open Sans', sans-serif;
        color: #333;
      }
      .navbar {
        margin-bottom: 20px;
        background-color: #007bff !important;
      }
      .navbar a.nav-link,
      .navbar .navbar-brand {
        color: #fff !important;
      }
      .navbar .nav-link:hover {
        color: #ddd !important;
      }
      .video-card { margin-bottom: 20px; }
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
        background-color: #007bff;
        color: #fff;
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
      }
      .preview-img {
        display: block;
        margin-top: 10px;
        max-width: 200px;
        height: auto;
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
                 <li class="nav-item"><a class="nav-link" href="/accountSettings">Account Settings</a></li>`
              : ''
          }
          ${ isAdminUser ? `<li class="nav-item"><a class="nav-link" href="/admin">Admin Panel</a></li>` : '' }
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
    <footer class="text-center">
      <p>By Villamor Gelera &mdash; Version 1.0.0</p>
    </footer>

    <!-- Bootstrap JS (for navbar toggling) -->
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

// ================== SEARCH ROUTE (PARTIAL MATCH) ==================
app.get('/search', async (req, res) => {
  const term = req.query.term || '';
  try {
    // Partial, case-insensitive match in title OR description
    const videos = await Video.find({
      $or: [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } }
      ]
    });
    let html = `<h2>Search Results for "${term}"</h2>`;
    if (videos.length === 0) {
      html += `<p>No videos found.</p>`;
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

// ========== LATEST & POPULAR ON HOME PAGE (with 7-day admin pin) ==========
app.get('/', async (req, res) => {
  try {
    let allVideos = await Video.find({}).populate('owner');
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Pinned admin videos (less than 7 days old)
    let pinnedAdmin = allVideos.filter(v => {
      if (!v.owner) return false;
      if (!v.owner.isAdmin) return false;
      return (now - v.uploadDate.getTime()) < ONE_WEEK;
    });

    // Sort pinned for LATEST (by date desc)
    pinnedAdmin.sort((a, b) => b.uploadDate - a.uploadDate);

    // Non-pinned
    let nonPinned = allVideos.filter(v => !pinnedAdmin.includes(v));

    // LATEST
    let sortedLatest = [...nonPinned].sort((a, b) => b.uploadDate - a.uploadDate);
    let finalLatest = [...pinnedAdmin, ...sortedLatest].slice(0, 5);

    // POPULAR
    // pinned admin videos sorted by likes desc
    let pinnedAdminPop = [...pinnedAdmin].sort((a, b) => b.likes.length - a.likes.length);
    // non pinned sorted by likes desc
    let nonPinnedPop = [...nonPinned].sort((a, b) => b.likes.length - a.likes.length);
    let finalPopular = [...pinnedAdminPop, ...nonPinnedPop].slice(0, 5);

    // Build HTML for LATEST
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

    // Build HTML for POPULAR
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

    let combinedHtml = `${latestHtml} ${popularHtml}`;
    res.send(renderPage(combinedHtml, req));
  } catch (err) {
    console.error('Error loading home videos:', err);
    res.send('Error loading videos.');
  }
});

// ========== CATEGORY ROUTES (Music, Gaming, News, General) ==========
// (Unchanged, see the previous code for these; they're included below for completeness)

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

// ========== LIVE PAGE ==========
app.get('/live', async (req, res) => {
  try {
    let liveUsers = await User.find({ isLive: true });
    let liveHtml = '<h2>Live Streams</h2>';
    if (liveUsers.length === 0) {
      liveHtml += '<p>No one is live right now.</p>';
    } else {
      liveUsers.forEach(u => {
        liveHtml += `
          <div class="card mb-3">
            <div class="card-body">
              <h4>${u.username} ${u.verified ? '<span class="badge badge-info">Verified</span>' : ''}</h4>
              <p>${u.about}</p>
              ${
                u.liveLink
                  ? `<iframe src="${u.liveLink}" width="100%" height="315" allowfullscreen></iframe>`
                  : '<p>(No live link provided)</p>'
              }
              <!-- Stream Key is hidden from public profile -->
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

// ========== AUTHENTICATION (Signup, Login, Logout, Verify Email) ==========

app.get('/signup', (req, res) => {
  const form = `
  <h2>Sign Up</h2>
  <p>Create an account to upload videos, go live with a personal stream key, and more!</p>
  <form method="POST" action="/signup">
    <div class="form-group">
      <label>Username:</label>
      <input type="text" name="username" class="form-control" required />
    </div>
    <div class="form-group">
      <label>Email:</label>
      <input type="email" name="email" class="form-control" required />
    </div>
    <div class="form-group">
      <label>Password:</label>
      <input type="password" name="password" class="form-control" required />
    </div>
    <button type="submit" class="btn btn-primary">Sign Up</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verifyToken: uuidv4(),
      streamKey:   uuidv4()
    });
    await newUser.save();
    res.send(`
      <p>Account created! Check your email for a verification link (not implemented).<br>
      <a href="/login">Click here to log in</a></p>
    `);
  } catch (err) {
    console.error('Error signing up:', err);
    res.send('Error signing up. Username or email might already be taken.');
  }
});

// Email verification route (fake email approach)
app.get('/verifyEmail', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.send('No token provided.');
  try {
    let user = await User.findOne({ verifyToken: token });
    if (!user) return res.send('Invalid token.');
    user.emailVerified = true;
    user.verifyToken   = '';
    await user.save();
    res.send('Email verified successfully! <a href="/login">Login</a>');
  } catch (err) {
    console.error('verifyEmail error:', err);
    res.send('Error verifying email.');
  }
});

// Login
app.get('/login', (req, res) => {
  const form = `
  <h2>Login</h2>
  <form method="POST" action="/login">
    <div class="form-group">
      <label>Username or Email:</label>
      <input type="text" name="loginField" class="form-control" required />
    </div>
    <div class="form-group">
      <label>Password:</label>
      <input type="password" name="password" class="form-control" required />
    </div>
    <button type="submit" class="btn btn-primary">Login</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

app.post('/login', async (req, res) => {
  const { loginField, password } = req.body;
  try {
    let user = await User.findOne({
      $or: [{ username: loginField }, { email: loginField }]
    });
    if (!user) return res.send('Invalid username/email or password.');
    if (user.banned) return res.send('Your account has been banned.');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid username/email or password.');
    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
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

// ========== VIDEO ROUTES (Upload, Edit, Delete, Watch, Like/Dislike, Comment, Download) ==========

// (The routes for uploading/editing/deleting videos remain the same as in the previous code. 
// They are included below for completeness, with no changes needed for the profile pic fix.)

app.get('/upload', isAuthenticated, (req, res) => {
  const form = `
  <h2>Upload Video</h2>
  <form method="POST" action="/upload" enctype="multipart/form-data">
    <div class="form-group">
      <label>Title:</label>
      <input type="text" name="title" class="form-control" required />
    </div>
    <div class="form-group">
      <label>Description:</label>
      <textarea name="description" class="form-control" required></textarea>
    </div>
    <div class="form-group">
      <label>Category:</label>
      <select name="category" class="form-control">
        <option value="Music">Music</option>
        <option value="Gaming">Gaming</option>
        <option value="News">News</option>
        <option value="General" selected>General</option>
      </select>
    </div>
    <div class="form-group">
      <label>Video File:</label>
      <input type="file" name="videoFile" class="form-control-file" accept="video/*" required />
    </div>
    <div class="form-group">
      <label>Thumbnail (optional):</label>
      <input type="file" name="thumbnailFile" class="form-control-file" accept="image/*" id="thumbnailFileInput"/>
      <img id="thumbnailFilePreview" class="preview-img" alt="Thumbnail Preview" />
    </div>
    <button type="submit" class="btn btn-primary">Upload</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

app.post('/upload', isAuthenticated, async (req, res) => {
  try {
    if (!req.files || !req.files.videoFile) {
      return res.send('No video file uploaded.');
    }
    let videoFile = req.files.videoFile;
    let videoUploadPath = path.join(__dirname, 'uploads', 'videos', Date.now() + '-' + videoFile.name);
    await videoFile.mv(videoUploadPath);

    let thumbnailPath = '/uploads/thumbnails/default.png';
    if (req.files.thumbnailFile) {
      let thumbFile = req.files.thumbnailFile;
      let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', Date.now() + '-' + thumbFile.name);
      await thumbFile.mv(thumbUploadPath);
      thumbnailPath = '/uploads/thumbnails/' + path.basename(thumbUploadPath);
    } else {
      // Auto-generate
      let thumbFileName = Date.now() + '-auto.png';
      let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', thumbFileName);
      await new Promise((resolve) => {
        ffmpeg(videoUploadPath)
          .on('end', () => {
            thumbnailPath = '/uploads/thumbnails/' + thumbFileName;
            resolve();
          })
          .on('error', err => {
            console.error('Thumbnail generation error:', err);
            resolve();
          })
          .screenshots({
            timestamps: [1],
            filename: thumbFileName,
            folder: path.join(__dirname, 'uploads', 'thumbnails'),
            size: '320x240'
          });
      });
    }

    let newVideo = new Video({
      title:       req.body.title,
      description: req.body.description,
      filePath:    '/uploads/videos/' + path.basename(videoUploadPath),
      thumbnail:   thumbnailPath,
      category:    req.body.category || 'General',
      owner:       req.session.userId
    });
    await newVideo.save();
    res.redirect('/');
  } catch (err) {
    console.error('Upload error:', err);
    res.send('Error uploading video.');
  }
});

// (Watch, Like/Dislike, Comment, Edit, Delete, Download - same as before, no changes needed.)

// ========== SUBSCRIBE / UNSUBSCRIBE ==========
app.post('/subscribe/:ownerId', isAuthenticated, async (req, res) => {
  try {
    let owner = await User.findById(req.params.ownerId);
    let user  = await User.findById(req.session.userId);
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

// ========== USER PROFILE & ACCOUNT SETTINGS ==========

app.get('/profile/:id', async (req, res) => {
  try {
    let userProfile = await User.findById(req.params.id);
    if (!userProfile) return res.send('User not found.');
    let videos = await Video.find({ owner: req.params.id });

    let videosHtml = '<div class="row">';
    videos.forEach(video => {
      let showThumb = video.thumbnail && !video.thumbnail.endsWith('default.png');
      let thumbTag = showThumb
        ? `<img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail"
                 data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">`
        : '';
      videosHtml += `
        <div class="col-md-4 mb-3">
          <div class="card video-card">
            ${thumbTag}
            <div class="card-body">
              <h5 class="card-title">${video.title}</h5>
              <p class="card-text">${video.description.substring(0, 60)}...</p>
              <a href="/video/${video._id}" class="btn btn-primary">Watch Video</a>
            </div>
          </div>
        </div>
      `;
    });
    videosHtml += '</div>';

    // If profilePic is default, show nothing
    let showProfilePic = userProfile.profilePic && !userProfile.profilePic.endsWith('default.png');
    let profilePicTag = showProfilePic
      ? `<img src="${userProfile.profilePic}" alt="Profile Picture" style="width:150px;height:150px; object-fit:cover;">`
      : '';

    let liveSection = '';
    if (userProfile.isLive) {
      liveSection = `
      <div class="alert alert-success mt-3">
        <strong>${userProfile.username} is LIVE!</strong><br>
        ${userProfile.liveLink
          ? `<iframe src="${userProfile.liveLink}" width="100%" height="315" allowfullscreen></iframe>`
          : '(No live link provided)'}
      </div>`;
    }

    // Stream Key is hidden from the public
    let profileHtml = `
    <h2>${userProfile.username} ${userProfile.verified ? '<span class="badge badge-info">Verified</span>' : ''}</h2>
    ${profilePicTag}
    <p class="mt-2">${userProfile.about}</p>
    <p>Subscribers: ${userProfile.subscribers.length}</p>
    <p>Email Verified: ${userProfile.emailVerified ? 'Yes' : 'No'}</p>
    ${liveSection}
    <h4 class="mt-4">Videos by ${userProfile.username}:</h4>
    ${videosHtml}
    `;
    res.send(renderPage(profileHtml, req));
  } catch (err) {
    console.error('Profile error:', err);
    res.send('Error loading profile.');
  }
});

// Update Profile route
app.post('/updateProfile', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');

    // Profile pic
    if (req.files && req.files.profilePic) {
      let pic = req.files.profilePic;
      let picPath = path.join(__dirname, 'uploads', 'profiles', Date.now() + '-' + pic.name);
      await pic.mv(picPath);
      user.profilePic = '/uploads/profiles/' + path.basename(picPath);
    }
    // Background pic
    if (req.files && req.files.backgroundPic) {
      let bg = req.files.backgroundPic;
      let bgPath = path.join(__dirname, 'uploads', 'backgrounds', Date.now() + '-' + bg.name);
      await bg.mv(bgPath);
      user.backgroundPic = '/uploads/backgrounds/' + path.basename(bgPath);
    }
    user.about = req.body.about;
    await user.save();
    res.redirect('/profile/' + user._id);
  } catch (err) {
    console.error('Profile update error:', err);
    res.send('Error updating profile.');
  }
});

// ========== ACCOUNT SETTINGS ==========

app.get('/accountSettings', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    const settingsHtml = `
      <h2>Account Settings</h2>
      <p>Email: ${user.email}</p>
      <p>Email Verified: ${user.emailVerified ? 'Yes' : 'No'}</p>
      ${
        user.emailVerified
          ? ''
          : `<p>Your email is not verified. <a href="/verifyEmailHelp">Click here</a> to see how to verify.</p>`
      }
      <hr>
      <h4>Change Password</h4>
      <form method="POST" action="/changePassword">
        <div class="form-group">
          <label>Old Password:</label>
          <input type="password" name="oldPassword" class="form-control" required />
        </div>
        <div class="form-group">
          <label>New Password:</label>
          <input type="password" name="newPassword" class="form-control" required />
        </div>
        <button type="submit" class="btn btn-primary">Change Password</button>
      </form>
      <hr>
      <h4>Stream Key</h4>
      <p>Current Key: ${user.streamKey}</p>
      <form method="POST" action="/generateStreamKey">
        <button type="submit" class="btn btn-info">Generate New Stream Key</button>
      </form>
      <hr>
      <h4>Live Settings</h4>
      <p>Current status: ${user.isLive ? 'LIVE' : 'Offline'}</p>
      <form method="POST" action="/setLiveLink">
        <div class="form-group">
          <label>Live Embed Link (e.g., YouTube embed URL):</label>
          <input type="text" name="liveLink" class="form-control" value="${user.liveLink}" />
        </div>
        <button type="submit" class="btn btn-info">Save Live Link</button>
      </form>
      <br>
      <form method="POST" action="/goLive">
        <button type="submit" class="btn btn-success" ${user.isLive ? 'disabled' : ''}>Go Live</button>
      </form>
      <form method="POST" action="/stopLive" style="margin-top:5px;">
        <button type="submit" class="btn btn-danger" ${user.isLive ? '' : 'disabled'}>Stop Live</button>
      </form>
    `;
    res.send(renderPage(settingsHtml, req));
  } catch (err) {
    console.error('AccountSettings error:', err);
    res.send('Error loading account settings.');
  }
});

// Verification help
app.get('/verifyEmailHelp', isAuthenticated, (req, res) => {
  const msg = `
    <h2>Email Verification Help</h2>
    <p>We do not send real emails. Your <strong>verifyToken</strong> was generated on sign up.
    Go to <code>/verifyEmail?token=YOURTOKEN</code> to verify. 
    <br>If lost, click below to regenerate a new token (in a real system, this would be emailed).</p>
    <form method="POST" action="/resendVerification">
      <button type="submit" class="btn btn-warning">Resend Verification Token</button>
    </form>
  `;
  res.send(renderPage(msg, req));
});

app.post('/resendVerification', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    user.verifyToken = uuidv4();
    await user.save();
    res.send(`
      <p>Your new verify token is: ${user.verifyToken}<br>
      Use /verifyEmail?token=${user.verifyToken} to verify.
      (Would be emailed in a real system.)</p>
    `);
  } catch (err) {
    res.send('Error resending token.');
  }
});

// Change Password
app.post('/changePassword', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    let user = await User.findById(req.session.userId);
    if (!user) return res.send('User not found.');
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.send('Old password is incorrect.');
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.send('<p>Password changed successfully! <a href="/accountSettings">Back to settings</a></p>');
  } catch (err) {
    res.send('Error changing password.');
  }
});

// Generate new stream key
app.post('/generateStreamKey', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.streamKey = uuidv4();
    await user.save();
    res.redirect('/accountSettings');
  } catch (err) {
    res.send('Error generating stream key.');
  }
});

// ========== LIVE STREAM ACTIONS ==========

app.post('/setLiveLink', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.liveLink = req.body.liveLink;
    await user.save();
    res.redirect('/accountSettings');
  } catch (err) {
    res.send('Error saving live link.');
  }
});

app.post('/goLive', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.isLive = true;
    await user.save();
    res.redirect('/accountSettings');
  } catch (err) {
    res.send('Error going live.');
  }
});

app.post('/stopLive', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.isLive = false;
    await user.save();
    res.redirect('/accountSettings');
  } catch (err) {
    res.send('Error stopping live.');
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
          <p>${user.username} (${user.email}) - ${user.banned ? '<span class="text-danger">Banned</span>' : 'Active'}
             ${
               user._id.toString() !== req.session.userId
                 ? `<form style="display:inline;" method="POST" action="/ban/${user._id}">
                      <button class="btn btn-danger btn-sm ml-2">Ban/Unban</button>
                    </form>`
                 : ''
             }
             ${
               !user.verified
                 ? `<form style="display:inline;" method="POST" action="/verify/${user._id}">
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

// Toggle Ban/Unban a User
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

// Legacy "verify" route for old `verified` field
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
