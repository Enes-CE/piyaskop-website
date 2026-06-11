/* Piyaskop hareket katmanı — açılış, paralaks, imleç ışığı, kart eğimi */
(function () {
  var docEl = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motionOn = docEl.classList.contains('js-motion');

  /* ---------- Açılış perdesi ---------- */
  var intro = document.getElementById('intro');
  var introOn = docEl.classList.contains('intro-on');

  function finishIntro() {
    if (docEl.classList.contains('intro-done')) { return; }
    docEl.classList.add('intro-done');
    if (intro) {
      setTimeout(function () {
        if (intro.parentNode) { intro.parentNode.removeChild(intro); }
        docEl.classList.remove('intro-on');
      }, 950);
    }
  }

  if (introOn && intro && motionOn) {
    requestAnimationFrame(function () {
      docEl.classList.add('intro-play');
    });
    setTimeout(finishIntro, 2050);
    // Emniyet: her durumda en geç 4 sn'de sayfa açılır
    setTimeout(finishIntro, 4000);
  } else {
    finishIntro();
  }

  if (!motionOn) { return; }

  /* ---------- Bölüm başlıklarını kelime maskelerine böl ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-split]'), function (el) {
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach(function (wd, i) {
      var w = document.createElement('span'); w.className = 'w';
      var wi = document.createElement('span'); wi.className = 'wi';
      wi.textContent = wd; wi.style.setProperty('--i', String(i));
      w.appendChild(wi); el.appendChild(w);
      if (i < words.length - 1) { el.appendChild(document.createTextNode(' ')); }
    });
  });

  /* ---------- Öne çıkan video: kaydırma ilerlemesiyle açılış ---------- */
  var featMedia = document.querySelector('.featured-media');
  var featInfo = document.querySelector('.featured-info');
  if (featMedia && !reduced) {
    var featTicking = false;
    var featUpdate = function () {
      var r = featMedia.getBoundingClientRect();
      var vh = window.innerHeight;
      var raw = (vh * 0.92 - r.top) / (vh * 0.55);
      var p = Math.max(0, Math.min(1, raw));
      p = p * p * (3 - 2 * p); // yumuşatma
      var m = parseFloat(getComputedStyle(docEl).getPropertyValue('--motion')) || 1;
      var k = (1 - p) * m;
      var rad = getComputedStyle(docEl).getPropertyValue('--radius').trim() || '14px';
      featMedia.style.clipPath = 'inset(' + (k * 4).toFixed(2) + '% ' + (k * 14).toFixed(2) + '% round ' + rad + ')';
      featMedia.style.transform = 'scale(' + (1 - 0.05 * k).toFixed(4) + ')';
      if (featInfo) { featInfo.classList.toggle('in', p > 0.55); }
      featTicking = false;
    };
    window.addEventListener('scroll', function () {
      if (!featTicking) { featTicking = true; requestAnimationFrame(featUpdate); }
    }, { passive: true });
    window.addEventListener('resize', featUpdate);
    featUpdate();
  } else if (featInfo) {
    featInfo.classList.add('in');
  }

  /* ---------- Hero paralaks (fare) ---------- */
  var hero = document.querySelector('.hero');
  if (hero && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      var px = ((e.clientX - r.left) / r.width - 0.5) * 2;
      var py = ((e.clientY - r.top) / r.height - 0.5) * 2;
      hero.style.setProperty('--px', px.toFixed(3));
      hero.style.setProperty('--py', py.toFixed(3));
    });
    hero.addEventListener('mouseleave', function () {
      hero.style.setProperty('--px', '0');
      hero.style.setProperty('--py', '0');
    });
  }

  /* ---------- İmleç ışığı ---------- */
  var glow = document.getElementById('cursor-glow');
  if (glow && window.matchMedia('(pointer: fine)').matches && !reduced) {
    var gx = -999, gy = -999, cx = -999, cy = -999, glowRaf = null;
    function glowTick() {
      cx += (gx - cx) * 0.12;
      cy += (gy - cy) * 0.12;
      glow.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)';
      if (Math.abs(gx - cx) > 0.3 || Math.abs(gy - cy) > 0.3) {
        glowRaf = requestAnimationFrame(glowTick);
      } else {
        glowRaf = null;
      }
    }
    window.addEventListener('mousemove', function (e) {
      gx = e.clientX; gy = e.clientY;
      glow.classList.add('on');
      if (cx === -999) { cx = gx; cy = gy; }
      if (!glowRaf) { glowRaf = requestAnimationFrame(glowTick); }
    });
    document.addEventListener('mouseleave', function () { glow.classList.remove('on'); });
  }

  /* ---------- Video kartları: 3B eğim + parıltı konumu ---------- */
  if (window.matchMedia('(pointer: fine)').matches) {
    Array.prototype.forEach.call(document.querySelectorAll('.video-card, .short-card'), function (card) {
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', ((py - 0.5) * -5).toFixed(2) + 'deg');
        card.style.setProperty('--ry', ((px - 0.5) * 7).toFixed(2) + 'deg');
        card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      });
      card.addEventListener('mouseleave', function () {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });

    /* ---------- Mıknatıslı düğmeler ---------- */
    Array.prototype.forEach.call(document.querySelectorAll('.btn'), function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        var m = parseFloat(getComputedStyle(docEl).getPropertyValue('--motion')) || 1;
        btn.style.translate = (dx * 0.14 * m).toFixed(1) + 'px ' + (dy * 0.22 * m).toFixed(1) + 'px';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.translate = '0px 0px';
      });
    });
  }

  /* ---------- Kaydırma ilerleme çubuğu ---------- */
  var progress = document.getElementById('scroll-progress');
  if (progress) {
    var progTicking = false;
    function updateProgress() {
      var max = docEl.scrollHeight - window.innerHeight;
      var p = max > 0 ? (window.scrollY / max) * 100 : 0;
      progress.style.width = p.toFixed(2) + '%';
      progTicking = false;
    }
    window.addEventListener('scroll', function () {
      if (!progTicking) { progTicking = true; requestAnimationFrame(updateProgress); }
    }, { passive: true });
    updateProgress();
  }

  /* ---------- Kademeli girişler için sıra numarası ---------- */
  ['.video-grid', '.sponsor-grid', '.shorts-row'].forEach(function (sel) {
    var grid = document.querySelector(sel);
    if (!grid) { return; }
    Array.prototype.forEach.call(grid.children, function (child, i) {
      child.style.setProperty('--i', String(i % 4));
    });
  });
})();
