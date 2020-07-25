document.write('\
  <div class="nav">\
    <ul>\
      <li><a id="index" href="index.html">About</a></li>\
      <li><a id="publications" href="publications.html">Publications</a></li>\
      <li><a id="research" href="research.html">Research Projects</a></li>\
      <li><a id="teaching" href="teaching.html">Teaching & Outreach</a></li>\
      <li><a id="news" href="news.html">News</a></li>\
      <li><a id="extracurricular" href="extracurricular.html">Extracurricular</a></li>\
    </ul>\
  </div>\
');
var page_id = window.location.pathname.split("/").pop().split(".").slice(0, 1);
document.getElementById(page_id).classList.add("active");
