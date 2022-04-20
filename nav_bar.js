document.write('\
    <div class="nav">\
    <ul>\
        <li><a id="index" href="index.html">About</a></li>\
        <li><a id="research" href="research.html">Research Projects</a></li>\
        <li><a id="publications" href="publications.html">Publications</a></li>\
        <li><a id="courses" href="courses.html">Courses</a></li>\
        <li><a id="software" href="software.html">Software & Tutorials</a></li>\
        <li><a id="blog" href="blog.html">Blog & News</a></li>\
    </ul>\
    </div>\
');
var page_id = window.location.pathname.split("/").pop().split(".").slice(0, 1);
document.getElementById(page_id).classList.add("active");

