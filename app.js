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
const sharp           = require('sharp'); // For resizing images

// For auto-generating video thumbnails with FFmpeg:
const ffmpeg          = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ================== INITIALIZE APP ==================
const app = express();
const PORT = process.env.PORT || 3000;

// ================== MONGODB CONNECTION ==================
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bahonlahat';
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

// ================== HTML RENDERER (Dark/Modern Design) ==================
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
        background: linear-gradient(to right, #2c2c2c, #1c1c1c);
        font-family: 'Poppins', sans-serif;
        color: #f1f1f1;
      }
      .navbar {
        margin-bottom: 20px;
        background-color: #242424 !important;
        border-bottom: 1px solid #555;
      }
      .navbar .navbar-brand,
      .navbar .nav-link {
        color: #f1f1f1 !important;
      }
      .navbar .nav-link:hover {
        color: #bbb !important;
      }
      .video-card {
        margin-bottom: 20px;
        background-color: #2e2e2e;
        border: 1px solid #444;
      }
      .video-card .card-body {
        color: #f1f1f1;
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
        background-color: #242424;
        color: #f1f1f1;
        text-align: center;
        border-top: 1px solid #555;
      }
      .tagline {
        font-size: 0.85rem;
        font-style: italic;
      }
      .category-badge {
        display: inline-block;
        padding: 2px 6px;
        font-size: 0.75rem;
        background-color: #444;
        border-radius: 4px;
      }
      .search-bar {
        width: 250px;
        margin-right: 10px;
        background-color: #3c3c3c !important;
        border: 1px solid #666 !important;
        color: #fff !important;
      }
      .preview-img {
        display: block;
        margin-top: 10px;
        max-width: 200px;
        height: auto;
      }
      .assistant-container {
        background-color: #2e2e2e;
        padding: 20px;
        border: 1px solid #444;
        margin-top: 20px;
        border-radius: 5px;
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

// ================== SIMPLE AI ASSISTANT (NAIVE) ==================
// We'll store conversation in session and respond with simple logic.

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

  // Naive logic: respond with a simple set of if/else. Real AI would require an external API.
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

// ================== SEARCH ROUTE (with fuzzy fallback) ==================
app.get('/search', async (req, res) => {
  const term = (req.query.term || '').trim();
  if (!term) {
    return res.send(renderPage('<h2>Please enter a search term.</h2>', req));
  }

  try {
    // We'll do partial, case-insensitive match in title OR description
    // If no direct match, we do a "fuzzy" approach by splitting the terms.
    const directMatches = await Video.find({
      $or: [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } }
      ]
    });

    let videos = directMatches;
    // If no direct matches, we do a simpler fallback: split the search term and try each word
    if (videos.length === 0) {
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

// ================== HOME PAGE (LATEST & POPULAR) with Admin Pin ==================
app.get('/', async (req, res) => {
  try {
    let allVideos = await Video.find({}).populate('owner');
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Identify pinned admin videos (less than 7 days old)
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
    let pinnedAdminPop = [...pinnedAdmin].sort((a, b) => b.likes.length - a.likes.length);
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
// ... (Already shown above)

// ========== LIVE PAGE ==========
// ... (Already shown above)

// ========== AUTHENTICATION (Signup, Login, Logout, Email Verify) ==========
// ... (Unchanged from previous code, see above)

// ========== VIDEO ROUTES ==========

// Upload Video: we do auto thumbnail generation with FFmpeg or user upload (resized below).
// See the route above in code. Next is watch/edit/delete/like/dislike, etc.

// WATCH VIDEO
app.get('/video/:id', async (req, res) => {
  try {
    let video = await Video.findById(req.params.id).populate('owner').populate('comments.user');
    if (!video) return res.send(renderPage('<h2>Video not found.</h2>', req));

    // SUGGESTED videos: same category, exclude current
    let suggested = await Video.find({
      category: video.category,
      _id: { $ne: video._id }
    }).limit(5);

    let suggestedHtml = '';
    suggested.forEach(sv => {
      let showThumb = sv.thumbnail && !sv.thumbnail.endsWith('default.png');
      let thumbTag = showThumb
        ? `<img src="${sv.thumbnail}" alt="Thumbnail"
                 class="video-thumbnail"
                 data-video="${sv.filePath}"
                 style="width:100%; max-height:100px; object-fit:cover;">`
        : '';
      suggestedHtml += `
      <div class="card mb-2 video-card">
        <div class="card-body p-2">
          ${thumbTag}
          <p class="mt-1 mb-1"><strong>${sv.title}</strong></p>
          <a href="/video/${sv._id}" class="btn btn-sm btn-primary">Watch</a>
        </div>
      </div>
      `;
    });

    // Subscribe button
    let subscribeButton = '';
    if (req.session.userId && req.session.userId !== video.owner._id.toString()) {
      let isSubscribed = video.owner.subscribers.includes(req.session.userId);
      subscribeButton = `
      <form method="POST" action="/subscribe/${video.owner._id}" style="display:inline;">
        <button class="btn btn-info">${isSubscribed ? 'Unsubscribe' : 'Subscribe'}</button>
      </form>
      `;
    }

    // Download button
    let downloadButton = `<a href="/download/${video._id}" class="btn btn-secondary">Download</a>`;

    // Like/Dislike, Edit/Delete, Comment, Share
    let likeBtn = '';
    let dislikeBtn = '';
    let editDelete = '';
    let commentForm = '';
    let shareButton = `<button class="btn btn-outline-light" onclick="shareVideo('${video.title}')">Share</button>`;

    if (req.session.userId) {
      likeBtn = `
        <form method="POST" action="/like/${video._id}" style="display:inline;">
          <button class="btn btn-success">Like (${video.likes.length})</button>
        </form>`;
      dislikeBtn = `
        <form method="POST" action="/dislike/${video._id}" style="display:inline;">
          <button class="btn btn-warning">Dislike (${video.dislikes.length})</button>
        </form>`;
      commentForm = `
        <form method="POST" action="/comment/${video._id}">
          <div class="form-group">
            <textarea name="comment" class="form-control" placeholder="Add a comment..." required></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Comment</button>
        </form>
      `;
      if (video.owner._id.toString() === req.session.userId) {
        editDelete = `
          <a href="/edit/${video._id}" class="btn btn-secondary">Edit</a>
          <form method="POST" action="/delete/${video._id}" style="display:inline;">
            <button type="submit" class="btn btn-danger">Delete</button>
          </form>
        `;
      }
    }

    // Comments
    let commentsHtml = '';
    video.comments.forEach(c => {
      commentsHtml += `<p><strong>${c.user.username}:</strong> ${c.comment}</p>`;
    });

    let videoPage = `
      <div class="row">
        <div class="col-md-8">
          <h2>${video.title}</h2>
          <video width="100%" height="auto" controls>
            <source src="${video.filePath}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
          <p class="mt-2">
            <span class="category-badge">${video.category}</span>
          </p>
          <p>${video.description}</p>
          <p>Uploaded by: <a href="/profile/${video.owner._id}">${video.owner.username}</a></p>
          ${subscribeButton} ${likeBtn} ${dislikeBtn} ${editDelete} ${downloadButton} ${shareButton}
          <hr>
          <h4>Comments</h4>
          ${commentsHtml}
          ${req.session.userId ? commentForm : '<p>Please log in to comment.</p>'}
        </div>
        <div class="col-md-4">
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

// LIKE VIDEO
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

// DISLIKE VIDEO
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

// COMMENT
app.post('/comment/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    video.comments.push({ user: req.session.userId, comment: req.body.comment });
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    res.send('Error commenting on video.');
  }
});

// EDIT VIDEO
app.get('/edit/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    const form = `
    <h2>Edit Video</h2>
    <form method="POST" action="/edit/${video._id}" enctype="multipart/form-data">
      <div class="form-group">
        <label>Title:</label>
        <input type="text" name="title" class="form-control" value="${video.title}" required />
      </div>
      <div class="form-group">
        <label>Description:</label>
        <textarea name="description" class="form-control" required>${video.description}</textarea>
      </div>
      <div class="form-group">
        <label>Category:</label>
        <select name="category" class="form-control">
          <option value="Music" ${video.category === 'Music' ? 'selected' : ''}>Music</option>
          <option value="Gaming" ${video.category === 'Gaming' ? 'selected' : ''}>Gaming</option>
          <option value="News" ${video.category === 'News' ? 'selected' : ''}>News</option>
          <option value="General" ${video.category === 'General' ? 'selected' : ''}>General</option>
        </select>
      </div>
      <div class="form-group">
        <label>Change Thumbnail (optional):</label>
        <input type="file" name="thumbnailFile" class="form-control-file" accept="image/*" id="thumbnailFileInput" />
        <img id="thumbnailFilePreview" class="preview-img" alt="Thumbnail Preview" />
      </div>
      <button type="submit" class="btn btn-primary">Update</button>
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
    video.title       = req.body.title;
    video.description = req.body.description;
    video.category    = req.body.category || 'General';

    // If a new thumbnail is uploaded, we’ll resize to 1920×1080
    if (req.files && req.files.thumbnailFile) {
      let thumbFile = req.files.thumbnailFile;
      let originalName = Date.now() + '-' + thumbFile.name;
      let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', originalName);

      // Move the file temporarily
      await thumbFile.mv(thumbUploadPath);

      // Use Sharp to resize to 1920x1080
      let resizedName = Date.now() + '-1920x1080.png';
      let resizedPath = path.join(__dirname, 'uploads', 'thumbnails', resizedName);

      await sharp(thumbUploadPath)
        .resize(1920, 1080, { fit: 'cover' })
        .toFile(resizedPath);

      // Clean up the original
      fs.unlinkSync(thumbUploadPath);

      video.thumbnail = '/uploads/thumbnails/' + resizedName;
    }
    await video.save();
    res.redirect('/video/' + req.params.id);
  } catch (err) {
    console.error('Edit error:', err);
    res.send('Error updating video.');
  }
});

// DELETE VIDEO
app.post('/delete/:id', isAuthenticated, async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    if (video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
    // Delete the actual video file from disk
    fs.unlink(path.join(__dirname, video.filePath), err => {
      if(err) console.log('Error deleting video file:', err);
    });
    await Video.deleteOne({ _id: req.params.id });
    res.redirect('/');
  } catch (err) {
    res.send('Error deleting video.');
  }
});

// DOWNLOAD
app.get('/download/:id', async (req, res) => {
  try {
    let video = await Video.findById(req.params.id);
    if (!video) return res.send('Video not found.');
    const filePath = path.join(__dirname, video.filePath);
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    console.error('Download error:', err);
    res.send('Error downloading file.');
  }
});

// ========== SUBSCRIBE / UNSUBSCRIBE ==========
// ... (shown above)

// ========== USER PROFILE & ACCOUNT SETTINGS ==========
// ... (shown above, includes updateProfile fix with Sharp resizing to 1920×1080 if needed? 
// For a profile pic we typically wouldn't want 1920×1080, but we can do it if you want.)

// Actually, let's also resize the profile pic to 400×400 for example. You can adjust as needed:
async function resizeProfilePic(filePath, width, height) {
  let outputName = Date.now() + '-resized.png';
  let outputPath = path.join(__dirname, 'uploads', 'profiles', outputName);
  await sharp(filePath)
    .resize(width, height, { fit: 'cover' })
    .toFile(outputPath);
  fs.unlinkSync(filePath); // remove original
  return '/uploads/profiles/' + outputName;
}

// For background, let's do 1920×1080. 
async function resizeBackgroundPic(filePath) {
  let outputName = Date.now() + '-bg.png';
  let outputPath = path.join(__dirname, 'uploads', 'backgrounds', outputName);
  await sharp(filePath)
    .resize(1920, 1080, { fit: 'cover' })
    .toFile(outputPath);
  fs.unlinkSync(filePath);
  return '/uploads/backgrounds/' + outputName;
}

app.post('/updateProfile', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');

    // Profile pic
    if (req.files && req.files.profilePic) {
      let pic = req.files.profilePic;
      let originalPath = path.join(__dirname, 'uploads', 'profiles', Date.now() + '-' + pic.name);
      await pic.mv(originalPath);
      // Now resize to 400×400
      user.profilePic = await resizeProfilePic(originalPath, 400, 400);
    }

    // Background pic
    if (req.files && req.files.backgroundPic) {
      let bg = req.files.backgroundPic;
      let originalBgPath = path.join(__dirname, 'uploads', 'backgrounds', Date.now() + '-' + bg.name);
      await bg.mv(originalBgPath);
      user.backgroundPic = await resizeBackgroundPic(originalBgPath);
    }

    user.about = req.body.about;
    await user.save();
    res.redirect('/profile/' + user._id);
  } catch (err) {
    console.error('Profile update error:', err);
    res.send('Error updating profile.');
  }
});

// ========== ADMIN PANEL ==========
// ... (same as above)

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
