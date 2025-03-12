// app.js

// ================== DEPENDENCIES ==================
const express      = require('express');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const session      = require('express-session');
const fileUpload   = require('express-fileupload');
const path         = require('path');
const fs           = require('fs');

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
const dirs = ['./uploads', './uploads/videos', './uploads/profiles', './uploads/backgrounds', './uploads/thumbnails'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// ================== MONGOOSE SCHEMAS ==================
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  isAdmin: { type: Boolean, default: false },
  banned: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  profilePic: { type: String, default: '/uploads/profiles/default.png' },
  backgroundPic: { type: String, default: '/uploads/backgrounds/default.png' },
  about: { type: String, default: '' }
});

const videoSchema = new mongoose.Schema({
  title: String,
  description: String,
  filePath: String,
  thumbnail: { type: String, default: '/uploads/thumbnails/default.png' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    comment: String,
    date: { type: Date, default: Date.now }
  }],
  uploadDate: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Video = mongoose.model('Video', videoSchema);

// ================== CREATE DEFAULT ADMIN ==================
async function createDefaultAdmin() {
  try {
    let admin = await User.findOne({ username: 'Villamor Gelera' });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('admin123', 10); // default password
      admin = new User({ username: 'Villamor Gelera', password: hashedPassword, isAdmin: true, verified: true });
      await admin.save();
      console.log('Default admin created: Villamor Gelera, password: admin123');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }
}
createDefaultAdmin();

// ================== HELPER MIDDLEWARE ==================
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session.userId) {
    User.findById(req.session.userId, (err, user) => {
      if (err || !user || !user.isAdmin) return res.send('Access denied.');
      next();
    });
  } else {
    res.redirect('/login');
  }
}

// Basic HTML wrapper with Bootstrap, custom CSS, and client-side JS
function renderPage(content, req) {
  const isAdminUser = req.session.isAdmin || false;
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Baho ng Lahat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <style>
      body { background-color: #f8f9fa; font-family: Arial, sans-serif; }
      .navbar { margin-bottom: 20px; }
      .video-card { margin-bottom: 20px; }
      .video-thumbnail {
        width: 100%;
        max-width: 300px;
        cursor: pointer;
        transition: transform 0.3s;
      }
      .video-thumbnail:hover { transform: scale(1.05); }
      .preview-video { width: 100%; max-width: 300px; display: none; }
      footer { margin-top: 50px; padding: 20px; background-color: #e9ecef; }
    </style>
  </head>
  <body>
    <nav class="navbar navbar-expand-lg navbar-light bg-light">
      <a class="navbar-brand" href="/">Baho ng Lahat</a>
      <div class="collapse navbar-collapse">
        <ul class="navbar-nav mr-auto">
          <li class="nav-item"><a class="nav-link" href="/">Home</a></li>
          <li class="nav-item"><a class="nav-link" href="/music">Music Genre</a></li>
          ${req.session.userId ? `<li class="nav-item"><a class="nav-link" href="/upload">Upload Video</a></li>` : ''}
          ${req.session.userId ? `<li class="nav-item"><a class="nav-link" href="/profile/${req.session.userId}">Profile</a></li>` : ''}
          ${isAdminUser ? `<li class="nav-item"><a class="nav-link" href="/admin">Admin Panel</a></li>` : ''}
        </ul>
        <ul class="navbar-nav">
          ${req.session.userId 
              ? `<li class="nav-item"><a class="nav-link" href="/logout">Logout (${req.session.username})</a></li>` 
              : `<li class="nav-item"><a class="nav-link" href="/login">Login</a></li>
                 <li class="nav-item"><a class="nav-link" href="/signup">Sign Up</a></li>`
          }
        </ul>
      </div>
    </nav>
    <div class="container">${content}</div>
    <footer class="text-center">
      <p>By Villamor Gelera</p>
    </footer>
    <script>
      // Basic preview functionality: when hovering on a thumbnail, replace with a playing video.
      document.querySelectorAll('.video-thumbnail').forEach(img => {
        img.addEventListener('mouseenter', function() {
          const videoUrl = this.getAttribute('data-video');
          const preview = document.createElement('video');
          preview.src = videoUrl;
          preview.autoplay = true;
          preview.muted = true;
          preview.loop = true;
          preview.style.width = this.width + 'px';
          this.parentNode.replaceChild(preview, this);
        });
      });
      // NOTE: For a robust solution, you might need to manage mouseout events and more.
    </script>
  </body>
  </html>
  `;
}

// ================== ROUTES ==================

// Home: list all videos with thumbnails
app.get('/', async (req, res) => {
  try {
    let videos = await Video.find({}).populate('owner');
    let videoHtml = '<div class="row">';
    videos.forEach(video => {
      videoHtml += `
      <div class="col-md-4">
        <div class="card video-card">
          <img src="${video.thumbnail}" alt="Thumbnail" class="card-img-top video-thumbnail" 
               data-video="${video.filePath}" data-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 100)}...</p>
            <a href="/video/${video._id}" class="btn btn-primary">Watch Video</a>
          </div>
        </div>
      </div>
      `;
    });
    videoHtml += '</div>';
    res.send(renderPage(videoHtml, req));
  } catch (err) {
    res.send('Error loading videos.');
  }
});

// Music Genre Page (available to guests)
app.get('/music', (req, res) => {
  const content = `
  <h2>Music Genres</h2>
  <div class="list-group">
    <a href="#" class="list-group-item list-group-item-action">Pop</a>
    <a href="#" class="list-group-item list-group-item-action">Rock</a>
    <a href="#" class="list-group-item list-group-item-action">Jazz</a>
    <a href="#" class="list-group-item list-group-item-action">Classical</a>
    <a href="#" class="list-group-item list-group-item-action">Hip-Hop</a>
  </div>
  `;
  res.send(renderPage(content, req));
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
  const user = await User.findOne({ username });
  if (!user) return res.send('Invalid username or password.');
  if (user.banned) return res.send('Your account has been banned.');
  const valid = await bcrypt.compare(password, user.password);
  if (valid) {
    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin  = user.isAdmin;
    res.redirect('/');
  } else {
    res.send('Invalid username or password.');
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
      <label>Video File:</label>
      <input type="file" name="videoFile" class="form-control-file" accept="video/*" required />
    </div>
    <div class="form-group">
      <label>Thumbnail (optional):</label>
      <input type="file" name="thumbnailFile" class="form-control-file" accept="image/*" />
    </div>
    <button type="submit" class="btn btn-primary">Upload</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

// Upload Video (POST handling)
app.post('/upload', isAuthenticated, async (req, res) => {
  if (!req.files || !req.files.videoFile) return res.send('No video file uploaded.');
  let videoFile = req.files.videoFile;
  let videoUploadPath = path.join(__dirname, 'uploads', 'videos', Date.now() + '-' + videoFile.name);
  
  // Handle optional thumbnail upload
  let thumbnailPath = '/uploads/thumbnails/default.png';
  if (req.files.thumbnailFile) {
    let thumbFile = req.files.thumbnailFile;
    let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', Date.now() + '-' + thumbFile.name);
    await thumbFile.mv(thumbUploadPath);
    thumbnailPath = '/uploads/thumbnails/' + path.basename(thumbUploadPath);
  }

  videoFile.mv(videoUploadPath, async (err) => {
    if(err) return res.send(err);
    let newVideo = new Video({
      title: req.body.title,
      description: req.body.description,
      filePath: '/uploads/videos/' + path.basename(videoUploadPath),
      thumbnail: thumbnailPath,
      owner: req.session.userId
    });
    await newVideo.save();
    res.redirect('/');
  });
});

// View Video and Actions
app.get('/video/:id', async (req, res) => {
  let video = await Video.findById(req.params.id).populate('owner').populate('comments.user');
  if (!video) return res.send('Video not found.');
  let likeBtn = `<form method="POST" action="/like/${video._id}" style="display:inline;">
                   <button class="btn btn-success">Like (${video.likes.length})</button>
                 </form>`;
  let dislikeBtn = `<form method="POST" action="/dislike/${video._id}" style="display:inline;">
                      <button class="btn btn-warning">Dislike (${video.dislikes.length})</button>
                    </form>`;
  let commentForm = `
  <form method="POST" action="/comment/${video._id}">
    <div class="form-group">
      <textarea name="comment" class="form-control" placeholder="Add a comment..." required></textarea>
    </div>
    <button type="submit" class="btn btn-primary">Comment</button>
  </form>
  `;
  let commentsHtml = '';
  video.comments.forEach(c => {
    commentsHtml += `<p><strong>${c.user.username}:</strong> ${c.comment}</p>`;
  });
  let editDelete = '';
  if(req.session.userId && video.owner._id.toString() === req.session.userId) {
    editDelete = `
    <a href="/edit/${video._id}" class="btn btn-secondary">Edit</a>
    <form method="POST" action="/delete/${video._id}" style="display:inline;">
      <button type="submit" class="btn btn-danger">Delete</button>
    </form>
    `;
  }
  let videoPage = `
  <h2>${video.title}</h2>
  <video width="640" height="360" controls>
    <source src="${video.filePath}" type="video/mp4">
    Your browser does not support the video tag.
  </video>
  <p>${video.description}</p>
  <p>Uploaded by: <a href="/profile/${video.owner._id}">${video.owner.username}</a></p>
  ${likeBtn} ${dislikeBtn} ${editDelete}
  <hr>
  <h4>Comments</h4>
  ${commentsHtml}
  ${req.session.userId ? commentForm : '<p>Please log in to comment.</p>'}
  `;
  res.send(renderPage(videoPage, req));
});

// Like Video
app.post('/like/:id', isAuthenticated, async (req, res) => {
  let video = await Video.findById(req.params.id);
  if (!video) return res.send('Video not found.');
  video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
  if(video.likes.includes(req.session.userId))
    video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
  else
    video.likes.push(req.session.userId);
  await video.save();
  res.redirect('/video/' + req.params.id);
});

// Dislike Video
app.post('/dislike/:id', isAuthenticated, async (req, res) => {
  let video = await Video.findById(req.params.id);
  if (!video) return res.send('Video not found.');
  video.likes = video.likes.filter(uid => uid.toString() !== req.session.userId);
  if(video.dislikes.includes(req.session.userId))
    video.dislikes = video.dislikes.filter(uid => uid.toString() !== req.session.userId);
  else
    video.dislikes.push(req.session.userId);
  await video.save();
  res.redirect('/video/' + req.params.id);
});

// Comment on Video
app.post('/comment/:id', isAuthenticated, async (req, res) => {
  let video = await Video.findById(req.params.id);
  if (!video) return res.send('Video not found.');
  video.comments.push({ user: req.session.userId, comment: req.body.comment });
  await video.save();
  res.redirect('/video/' + req.params.id);
});

// Edit Video (only owner)
app.get('/edit/:id', isAuthenticated, async (req, res) => {
  let video = await Video.findById(req.params.id);
  if (!video) return res.send('Video not found.');
  if(video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
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
      <label>Change Thumbnail (optional):</label>
      <input type="file" name="thumbnailFile" class="form-control-file" accept="image/*" />
    </div>
    <button type="submit" class="btn btn-primary">Update</button>
  </form>
  `;
  res.send(renderPage(form, req));
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
  let video = await Video.findById(req.params.id);
  if (!video) return res.send('Video not found.');
  if(video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
  video.title = req.body.title;
  video.description = req.body.description;
  if (req.files && req.files.thumbnailFile) {
    let thumbFile = req.files.thumbnailFile;
    let thumbUploadPath = path.join(__dirname, 'uploads', 'thumbnails', Date.now() + '-' + thumbFile.name);
    await thumbFile.mv(thumbUploadPath);
    video.thumbnail = '/uploads/thumbnails/' + path.basename(thumbUploadPath);
  }
  await video.save();
  res.redirect('/video/' + req.params.id);
});

// Delete Video (only owner)
app.post('/delete/:id', isAuthenticated, async (req, res) => {
  let video = await Video.findById(req.params.id);
  if (!video) return res.send('Video not found.');
  if(video.owner.toString() !== req.session.userId) return res.send('Unauthorized.');
  fs.unlink(path.join(__dirname, video.filePath), err => { if(err) console.log(err); });
  await Video.deleteOne({ _id: req.params.id });
  res.redirect('/');
});

// ========== USER PROFILE ==========

// View Profile
app.get('/profile/:id', async (req, res) => {
  let userProfile = await User.findById(req.params.id);
  if (!userProfile) return res.send('User not found.');
  let videos = await Video.find({ owner: req.params.id });
  let videosHtml = '<div class="row">';
  videos.forEach(video => {
    videosHtml += `
      <div class="col-md-4">
        <div class="card video-card">
          <img src="${video.thumbnail}" alt="Thumbnail" class="card-img-top video-thumbnail" 
               data-video="${video.filePath}" data-thumbnail="${video.thumbnail}">
          <div class="card-body">
            <h5 class="card-title">${video.title}</h5>
            <p class="card-text">${video.description.substring(0, 100)}...</p>
            <a href="/video/${video._id}" class="btn btn-primary">Watch Video</a>
          </div>
        </div>
      </div>
    `;
  });
  videosHtml += '</div>';
  let profileHtml = `
  <h2>${userProfile.username} ${userProfile.verified ? '<span class="badge badge-info">Verified</span>' : ''}</h2>
  <img src="${userProfile.profilePic}" alt="Profile Picture" style="width:150px;height:150px;">
  <p>${userProfile.about}</p>
  <h4>Videos:</h4>
  ${videosHtml}
  `;
  if(req.session.userId && req.session.userId === req.params.id) {
    profileHtml += `
    <hr>
    <h3>Update Profile</h3>
    <form method="POST" action="/updateProfile" enctype="multipart/form-data">
      <div class="form-group">
        <label>Profile Picture:</label>
        <input type="file" name="profilePic" accept="image/*" class="form-control-file" />
      </div>
      <div class="form-group">
        <label>Background Picture:</label>
        <input type="file" name="backgroundPic" accept="image/*" class="form-control-file" />
      </div>
      <div class="form-group">
        <label>About Me:</label>
        <textarea name="about" class="form-control">${userProfile.about}</textarea>
      </div>
      <button type="submit" class="btn btn-primary">Update Profile</button>
    </form>
    `;
  }
  res.send(renderPage(profileHtml, req));
});

// Update Profile (POST)
app.post('/updateProfile', isAuthenticated, async (req, res) => {
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
});

// ========== ADMIN PANEL ==========

app.get('/admin', isAdmin, async (req, res) => {
  try {
    let users = await User.find({});
    let userHtml = '<h2>Admin Panel - Manage Users</h2>';
    users.forEach(user => {
      userHtml += `<p>${user.username} - ${user.banned ? 'Banned' : 'Active'} 
      ${user._id.toString() !== req.session.userId ? `
        <form style="display:inline;" method="POST" action="/ban/${user._id}">
          <button class="btn btn-danger btn-sm">Ban/Unban</button>
        </form>` : ''}
      ${!user.verified ? `
        <form style="display:inline;" method="POST" action="/verify/${user._id}">
          <button class="btn btn-info btn-sm">Verify</button>
        </form>` : ''}
      </p>`;
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
