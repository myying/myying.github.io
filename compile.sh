#!/bin/bash
###check system
date_cmd='date'
if [ `uname` == 'Darwin' ]; then
    date_cmd='gdate'
fi
for app in pandoc; do
    if ! command -v $app &> /dev/null; then
        echo "$app is not found! aborting"
        exit
    fi
done

##common html start and end to all pages:
function html_start() {
cat << EOF
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="Yue (Michael) Ying">
<meta name="keywords" content="data assimilation, predictability, multiscale, meteorology, research">
<meta name="author" content="Yue Ying">

<link rel="apple-touch-icon" sizes="180x180" href="site_img/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="site_img/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="site_img/favicon-16x16.png">
<link rel="manifest" href="site_img/site.webmanifest">

<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
<link rel="stylesheet" href="style.css">

<!-- Global site tag (gtag.js) - Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=UA-148955805-2"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'UA-148955805-2');
</script>

<!-- MathJax -->
<script type="text/javascript" async
  src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.4/MathJax.js?config=TeX-MML-AM_CHTML">
</script>

<title>Yue (Michael) Ying</title>
</head>

<body>
  <div class="header">
    <h1>Yue (Michael) Ying</h1>
  </div>

  <script src="nav_bar.js"></script>

  <div class="container">
EOF
}

function html_end(){
cat << EOF
  </div>

  <script src="footer.js"></script>
</body>
</html>
EOF
}


###index page (home, about)
rm -f index.html
html_start >> index.html
cat pages/about.html >> index.html
html_end >> index.html

###publication page
rm -f publications.html
html_start >> publications.html
echo '    <div class="page" id="publications">' >> publications.html
for item in `find pages/publications/* -maxdepth 0 |sort -r`; do
    echo '<p><i class="fa fa-file-text-o"></i> ' >> publications.html
    echo `cat $item/author`', '`cat $item/year`':<br/> ' >> publications.html
    echo `cat $item/title`'.<br/>' >> publications.html
    if [[ `cat $item/status` == 'published' ]]; then
        echo '<i>'`cat $item/journal`'</i>, '`cat $item/issue`', '`cat $item/pages`'. ' >> publications.html
        echo '<font size=2><i class="fa fa-external-link"></i> <a href="https://doi.org/'`cat $item/doi`'">Web link</a></font> &nbsp;' >> publications.html
        echo '<font size=2><i class="fa fa-download"></i> <a href="'$item'/print.pdf">PDF</a></font>' >> publications.html
    fi
    if [[ `cat $item/status` == 'in review' ]]; then
        echo '<i>'`cat $item/journal`'</i>, in review.' >> publications.html
        if [ -f $item/preprint.pdf ]; then
            echo '<font size=2><i class="fa fa-download"></i> <a href="'$item'/preprint.pdf">preprint</a></font>' >> publications.html
        fi
    fi
    if [[ `cat $item/status` == 'in prep' ]]; then
        echo 'in prep.' >> publications.html
    fi
    echo '</p><br/>' >> publications.html
done
echo '    </div>' >> publications.html
html_end >> publications.html

###research projects, courses and software/tutorial pages
for page in research courses software; do
    rm -f $page.html
    html_start >> $page.html
    echo '    <div class="page" id="'$page'">' >> $page.html
    for item in `find pages/$page/* -maxdepth 0 |sort -t'/' -k3 -r`; do
        echo '<h2 id="'`basename $item`'">'`cat $item/title`'</h2>' >> $page.html
        cat $item/abstract.html >> $page.html
        if [ -f $item/article.html ]; then
            echo '<p><i class="fa fa-caret-right"></i> <a href="'$item'/article.html">Read More</a></p>' >> $page.html
        fi
        echo '<br/>' >> $page.html
    done
    html_end >> $page.html
done

###blog page
rm -f blog.html
html_start >> blog.html
echo '    <div class="page" id="blog">' >> blog.html
for item in `find pages/presentations/* pages/other_events/* -maxdepth 0 |sort -t'/' -k3 -r`; do
    date=`basename $item`
    echo "<h2 id='$date'>"`$date_cmd -d $date +'%b %_d, %Y'`"</h2>" >> blog.html
    echo "<p>"`cat $item/post.html`"</p>" >> blog.html
done
echo '    </div>' >> blog.html
html_end >> blog.html


###build cv
pushd pages/cv; bash compile.sh; popd
