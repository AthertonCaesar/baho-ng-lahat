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
  username:     { type: String, unique: true },
  password:     String,
  isAdmin:      { type: Boolean, default: false },
  banned:       { type: Boolean, default: false },
  verified:     { type: Boolean, default: false },
  subscribers:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  profilePic:   { type: String, default: '/uploads/profiles/default.png' },
  backgroundPic:{ type: String, default: '/uploads/backgrounds/default.png' },
  about:        { type: String, default: '' },
  // Live streaming placeholders:
  isLive:       { type: Boolean, default: false },
  liveLink:     { type: String, default: '' }
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

// ================== HTML RENDERER (WITH SCRIPTS) ==================
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
    <style>
        :root {
            --primary: #6366f1;
            --primary-hover: #4f46e5;
            --dark: #1e293b;
            --light: #f8fafc;
        }

        body {
            background: var(--light);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .navbar {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.video-card {
  border: 0;
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: white;
  position: relative;
}

.video-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.video-card:hover::before {
  opacity: 1;
}

.video-thumbnail {
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 16px 16px 0 0;
  aspect-ratio: 16/9;
}

.card-body {
  padding: 1.5rem;
}

.card-title {
  font-size: 1rem;
  margin-bottom: 0.5rem !important;
}

        .btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);
}

        footer {
  background: #1e293b;
  color: rgba(255, 255, 255, 0.9);
  padding: 3rem 0;
  margin-top: 4rem;
}

        .preview-img {
            border-radius: 8px;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
            margin: 1rem 0;
        }

        .badge {
            background: var(--primary);
            font-weight: 500;
        }

        .form-control {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  transition: all 0.3s ease;
}

.form-control:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.form-group {
  margin-bottom: 1.5rem;
}

.preview-img {
  border-radius: 12px;
  margin-top: 1rem;
  max-width: 200px;
  height: auto;
  border: 2px solid #e2e8f0;
}

        .navbar-brand {
  color: white !important;
  font-weight: 700;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

        .navbar-brand:hover {
  opacity: 0.9;
}
    </style>
    <!-- Add Inter Font -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
    <nav class="navbar navbar-expand-lg sticky-top">
        <div class="container">
            <a class="navbar-brand" href="/">
  <span style="font-size: 1.5rem;">Baho</span>
  <span style="font-weight: 300;">ng</span>
  <span style="font-size: 1.5rem;">Lahat</span>
</a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarNav">
                <ul class="navbar-nav me-auto">
          <li class="nav-item"><a class="nav-link" href="/">Home</a></li>
          <li class="nav-item"><a class="nav-link" href="/music">Music</a></li>
          <li class="nav-item"><a class="nav-link" href="/gaming">Gaming</a></li>
          <li class="nav-item"><a class="nav-link" href="/news">News</a></li>
          <li class="nav-item"><a class="nav-link" href="/general">General</a></li>
          <li class="nav-item"><a class="nav-link" href="/live">Live</a></li>
          ${
            req.session.userId
              ? `<li class="nav-item"><a class="nav-link" href="/upload">Upload Video</a></li>
                 <li class="nav-item"><a class="nav-link" href="/profile/${req.session.userId}">Profile</a></li>`
              : ''
          }
          ${ isAdminUser ? `<li class="nav-item"><a class="nav-link" href="/admin">Admin Panel</a></li>` : '' }
        </ul>
        <ul class="navbar-nav">
          ${
            req.session.userId
              ? `<li class="nav-item"><a class="nav-link" href="/logout">Logout (${username})</a></li>`
              : `<li class="nav-item"><a class="nav-link" href="/login">Login</a></li>
                 <li class="nav-item"><a class="nav-link" href="/signup">Sign Up</a></li>`
          }
        </ul>
            </div>
        </div>
    </nav>

    <main class="container py-4 flex-grow-1">
        ${content}
    </main>

    <footer class="text-center">
        <div class="container">
            content: "Created by Villamor Gelera";
  display: block;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.25rem;
}

    <!-- Bootstrap 5 JS -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

    <script>
      // 1) Thumbnail preview with a mini autoplay on hover:
      document.querySelectorAll('.video-thumbnail').forEach(img => {
        img.addEventListener('mouseenter', function() {
          const videoUrl = this.getAttribute('data-video');
          // If there's no valid video file or it doesn't look like a video, do nothing
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
      // We call setupPreview for relevant fields in forms
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

// ========== HOME PAGE: LATEST & POPULAR ==========
app.get('/', async (req, res) => {
  try {
    let allVideos = await Video.find({}).populate('owner');
    // Sort for latest videos (by date descending)
    let latestVideos = [...allVideos].sort((a, b) => b.uploadDate - a.uploadDate).slice(0, 5);
    // Sort for popular videos (by likes descending)
    let popularVideos = [...allVideos].sort((a, b) => b.likes.length - a.likes.length).slice(0, 5);

    let latestHtml = '<h3>Latest Videos</h3><div class="row">';
    latestVideos.forEach(video => {
      latestHtml += `
      <div class="col-md-4">
        <div class="card video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Category: ${video.category}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
          </div>
        </div>
      </div>
      `;
    });
    latestHtml += '</div>';

    let popularHtml = '<h3 class="mt-4">Popular Videos</h3><div class="row">';
    popularVideos.forEach(video => {
      popularHtml += `
      <div class="col-md-4">
        <div class="card video-card">
          <img src="${video.thumbnail}" alt="Thumbnail"
               class="card-img-top video-thumbnail"
               data-video="${video.filePath}"
               style="max-height:200px; object-fit:cover;">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 60)}...</p>
            <p class="text-muted"><small>Likes: ${video.likes.length}</small></p>
            <a href="/video/${video._id}" class="btn btn-primary">Watch</a>
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
app.get('/music', async (req, res) => {
  try {
    let videos = await Video.find({ category: 'Music' });
    let videoHtml = '<h2>Music Videos</h2><div class="row">';
    videos.forEach(video => {
      videoHtml += `
        <div class="col-md-4">
          <div class="card video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail"
                 data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
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
      videoHtml += `
        <div class="col-md-4">
          <div class="card video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail"
                 data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
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
      videoHtml += `
        <div class="col-md-4">
          <div class="card video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail"
                 data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
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
      videoHtml += `
        <div class="col-md-4">
          <div class="card video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail"
                 data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
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
                  ? `<iframe src="${u.liveLink}" width="560" height="315" allowfullscreen></iframe>`
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

// ========== AUTHENTICATION ==========

// Signup
app.get('/signup', (req, res) => {
  const form = `
  <h2>Sign Up</h2>
  <form method="POST" action="/signup">
    <div class="form-group">
      <label>Username:</label>
      <input type="text" name="username" class="form-control" required />
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
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    console.error('Error signing up:', err);
    res.send('Error signing up. Username might already be taken.');
  }
});

// Login
app.get('/login', (req, res) => {
  const form = `
  <h2>Login</h2>
  <form method="POST" action="/login">
    <div class="form-group">
      <label>Username:</label>
      <input type="text" name="username" class="form-control" required />
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
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.send('Invalid username or password.');
    if (user.banned) return res.send('Your account has been banned.');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid username or password.');
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

// ========== VIDEO ROUTES ==========

// Upload Video (GET form)
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

// Upload Video (POST handling)
app.post('/upload', isAuthenticated, async (req, res) => {
  try {
    if (!req.files || !req.files.videoFile) {
      return res.send('No video file uploaded.');
    }
    // 1) Move the video file to disk
    let videoFile = req.files.videoFile;
    let videoUploadPath = path.join(__dirname, 'uploads', 'videos', Date.now() + '-' + videoFile.name);
    await videoFile.mv(videoUploadPath);

    // 2) If user didn't provide a thumbnail, auto-generate one from the video
    let thumbnailPath = '/uploads/thumbnails/default.png';
    if (req.files.thumbnailFile) {
      // They uploaded a custom thumbnail
      let thumbFile = req.files.thumbnailFile;
      let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', Date.now() + '-' + thumbFile.name);
      await thumbFile.mv(thumbUploadPath);
      thumbnailPath = '/uploads/thumbnails/' + path.basename(thumbUploadPath);
    } else {
      // Auto-generate using FFmpeg
      let thumbFileName = Date.now() + '-auto.png';
      let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', thumbFileName);
      // We'll pick a frame at 1 second
      await new Promise((resolve, reject) => {
        ffmpeg(videoUploadPath)
          .on('end', () => {
            console.log('Thumbnail generated');
            thumbnailPath = '/uploads/thumbnails/' + thumbFileName;
            resolve();
          })
          .on('error', err => {
            console.error('Thumbnail generation error:', err);
            // fallback to default
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

    // 3) Create and save the new video document
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

// View Video and Actions
app.get('/video/:id', async (req, res) => {
  try {
    let video = await Video.findById(req.params.id).populate('owner').populate('comments.user');
    if (!video) return res.send('Video not found.');

    // SUGGESTED videos: same category, exclude current
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
               style="width:100%; max-height:100px; object-fit:cover;">
          <p class="mt-1 mb-1"><strong>${sv.title}</strong></p>
          <a href="/video/${sv._id}" class="btn btn-sm btn-primary">Watch</a>
        </div>
      </div>
      `;
    });

    // Check if the viewer is subscribed to the owner
    let subscribeButton = '';
    if (req.session.userId && req.session.userId !== video.owner._id.toString()) {
      // The user is not the owner, so maybe subscribe/unsubscribe
      let isSubscribed = video.owner.subscribers.includes(req.session.userId);
      subscribeButton = `
      <form method="POST" action="/subscribe/${video.owner._id}" style="display:inline;">
        <button class="btn btn-info">${isSubscribed ? 'Unsubscribe' : 'Subscribe'}</button>
      </form>
      `;
    }

    // Download button
    let downloadButton = `
      <a href="/download/${video._id}" class="btn btn-secondary">Download</a>
    `;

    // Like/Dislike, Edit/Delete, Comment
    let likeBtn = '';
    let dislikeBtn = '';
    let editDelete = '';
    let commentForm = '';
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

    // "Share" button (calls shareVideo(...) in the script)
    let shareButton = `
      <button class="btn btn-outline-primary" onclick="shareVideo('${video.title}')">Share</button>
    `;

    // Layout: main video left (col-8), suggestions right (col-4)
    let videoPage = `
  <div class="row">
    <div class="col-lg-8">
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body p-0">
          <video class="rounded-top" width="100%" height="auto" controls controlsList="nodownload">
            <source src="${video.filePath}" type="video/mp4">
          </video>
          <div class="p-4">
            <h1 class="h2 mb-3">${video.title}</h1>
            <div class="d-flex gap-2 mb-3">
              ${subscribeButton}
              ${likeBtn} 
              ${dislikeBtn}
              ${shareButton}
            </div>
            <div class="d-flex gap-2 align-items-center mb-4">
              <img src="${video.owner.profilePic}" 
                   class="rounded-circle" 
                   style="width:40px;height:40px;object-fit:cover;">
              <div>
                <a href="/profile/${video.owner._id}" class="text-decoration-none h5 mb-0">${video.owner.username}</a>
                <p class="text-muted small mb-0">${video.owner.subscribers.length} subscribers</p>
              </div>
            </div>
            <div class="card mb-4">
              <div class="card-body">
                <h3 class="h5">Description</h3>
                <p class="mb-0">${video.description}</p>
              </div>
            </div>
            ${commentsHtml}
            ${req.session.userId ? commentForm : '<p>Please log in to comment.</p>'}
          </div>
        </div>
      </div>
    </div>
    <div class="col-lg-4">
      <h3 class="h5 mb-3">Suggested Videos</h3>
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
    // Remove from dislikes if present
    video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    // Toggle like
    if (video.likes.includes(req.session.userId)) {
      // Already liked -> remove like
      video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      // Not liked -> add
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
    // Remove from likes if present
    video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
    // Toggle dislike
    if (video.dislikes.includes(req.session.userId)) {
      // Already disliked -> remove dislike
      video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
    } else {
      // Not disliked -> add
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

// ========== DOWNLOAD FEATURE ==========
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
app.post('/subscribe/:ownerId', isAuthenticated, async (req, res) => {
  try {
    let owner = await User.findById(req.params.ownerId);
    let user  = await User.findById(req.session.userId);
    if (!owner || !user) return res.send('User not found.');
    if (owner._id.toString() === user._id.toString()) {
      return res.send('You cannot subscribe to yourself.');
    }
    // Toggle subscription
    if (owner.subscribers.includes(user._id)) {
      // Already subscribed -> unsubscribe
      owner.subscribers = owner.subscribers.filter(sid => sid.toString() !== user._id.toString());
    } else {
      // Not subscribed -> subscribe
      owner.subscribers.push(user._id);
    }
    await owner.save();
    res.redirect('back');
  } catch (err) {
    res.send('Error subscribing/unsubscribing.');
  }
});

// ========== USER PROFILE ==========

// View Profile
app.get('/profile/:id', async (req, res) => {
  try {
    let userProfile = await User.findById(req.params.id);
    if (!userProfile) return res.send('User not found.');
    // Fetch videos
    let videos = await Video.find({ owner: req.params.id });
    let videosHtml = '<div class="row">';
    videos.forEach(video => {
      videosHtml += `
        <div class="col-md-4">
          <div class="card video-card">
            <img src="${video.thumbnail}" alt="Thumbnail"
                 class="card-img-top video-thumbnail"
                 data-video="${video.filePath}"
                 style="max-height:200px; object-fit:cover;">
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

    let liveSection = '';
    if (userProfile.isLive) {
      liveSection = `
      <div class="alert alert-success mt-3">
        <strong>${userProfile.username} is LIVE!</strong><br>
        ${userProfile.liveLink
          ? `<iframe src="${userProfile.liveLink}" width="560" height="315" allowfullscreen></iframe>`
          : '(No live link provided)'}
      </div>`;
    }

    let profileHtml = `
    <div class="mb-4">
  <div class="card border-0 shadow-sm">
    <div class="card-body position-relative" 
         style="background: url('${userProfile.backgroundPic}') center center/cover; 
                min-height: 200px;
                border-radius: 16px;">
      <div class="position-absolute bottom-0 start-0 translate-y-50 ms-4">
        <img src="${userProfile.profilePic}" 
             class="rounded-circle border-4 border-white shadow"
             style="width:100px;height:100px;object-fit:cover;">
      </div>
    </div>
    <div class="card-body pt-5 mt-4">
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <h1 class="h2 mb-0">${userProfile.username}</h1>
          ${userProfile.verified ? '<span class="badge bg-primary">Verified Creator</span>' : ''}
        </div>
        <div class="text-muted">${userProfile.subscribers.length} subscribers</div>
      </div>
      <p class="lead mt-3">${userProfile.about}</p>
      ${liveSection}
    </div>
  </div>
</div>
`;

    // If this is the owner, allow editing profile and live status
    if(req.session.userId && req.session.userId === req.params.id) {
      profileHtml += `
      <hr>
      <h3>Update Profile</h3>
      <form method="POST" action="/updateProfile" enctype="multipart/form-data">
        <div class="form-group">
          <label>Profile Picture:</label>
          <input type="file" name="profilePic" accept="image/*" class="form-control-file" id="profilePicInput" />
          <img id="profilePicPreview" class="preview-img" alt="Profile Pic Preview" />
        </div>
        <div class="form-group">
          <label>Background Picture:</label>
          <input type="file" name="backgroundPic" accept="image/*" class="form-control-file" id="backgroundPicInput" />
          <img id="backgroundPicPreview" class="preview-img" alt="Background Pic Preview" />
        </div>
        <div class="form-group">
          <label>About Me:</label>
          <textarea name="about" class="form-control">${userProfile.about}</textarea>
        </div>
        <button type="submit" class="btn btn-primary">Update Profile</button>
      </form>
      <hr>
      <h3>Live Stream Settings</h3>
      <p>Current status: ${userProfile.isLive ? 'LIVE' : 'Offline'}</p>
      <form method="POST" action="/setLiveLink">
        <div class="form-group">
          <label>Live Embed Link (e.g., YouTube embed URL):</label>
          <input type="text" name="liveLink" class="form-control" value="${userProfile.liveLink}" />
        </div>
        <button type="submit" class="btn btn-info">Save Live Link</button>
      </form>
      <br>
      <form method="POST" action="/goLive">
        <button type="submit" class="btn btn-success" ${userProfile.isLive ? 'disabled' : ''}>Go Live</button>
      </form>
      <form method="POST" action="/stopLive" style="margin-top:5px;">
        <button type="submit" class="btn btn-danger" ${userProfile.isLive ? '' : 'disabled'}>Stop Live</button>
      </form>
      `;
    }
    res.send(renderPage(profileHtml, req));
  } catch (err) {
    console.error('Profile error:', err);
    res.send('Error loading profile.');
  }
});

// Update Profile
app.post('/updateProfile', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    if(req.files && req.files.profilePic) {
      let pic = req.files.profilePic;
      let picPath = path.join(__dirname, 'uploads', 'profiles', Date.now() + '-' + pic.name);
      await pic.mv(picPath);
      user.profilePic = '/uploads/profiles/' + path.basename(picPath);
    }
    if(req.files && req.files.backgroundPic) {
      let bg = req.files.backgroundPic;
      let bgPath = path.join(__dirname, 'uploads', 'backgrounds', Date.now() + '-' + bg.name);
      await bg.mv(bgPath);
      user.backgroundPic = '/uploads/backgrounds/' + path.basename(bgPath);
    }
    user.about = req.body.about;
    await user.save();
    res.redirect('/profile/' + req.session.userId);
  } catch (err) {
    console.error('Profile update error:', err);
    res.send('Error updating profile.');
  }
});

// ========== LIVE STREAM ACTIONS ==========
// Save the user's liveLink
app.post('/setLiveLink', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.liveLink = req.body.liveLink;
    await user.save();
    res.redirect('/profile/' + user._id);
  } catch (err) {
    res.send('Error saving live link.');
  }
});

// Go Live
app.post('/goLive', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.isLive = true;
    await user.save();
    res.redirect('/profile/' + user._id);
  } catch (err) {
    res.send('Error going live.');
  }
});

// Stop Live
app.post('/stopLive', isAuthenticated, async (req, res) => {
  try {
    let user = await User.findById(req.session.userId);
    if(!user) return res.send('User not found.');
    user.isLive = false;
    await user.save();
    res.redirect('/profile/' + user._id);
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
          <p>${user.username} - ${user.banned ? '<span class="text-danger">Banned</span>' : 'Active'}
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
                      <button class="btn btn-info btn-sm ml-2">Verify</button>
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

// Toggle Ban/Unban a User (Admin only)
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

// Verify a User (Admin only)
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
