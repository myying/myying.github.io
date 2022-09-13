#!/bin/bash
###system check
date_cmd='date'
if [ `uname` == 'Darwin' ]; then
    date_cmd='gdate'
fi
for app in pandoc latexmk; do
    if ! command -v $app &> /dev/null; then
        echo "$app is not found! aborting"
        exit
    fi
done

###publication section
rm -f publications.tex
echo "\begin{enumerate}" >> publications.tex
for item in `find ../publications/* -maxdepth 0 |sort -r`; do
    echo "\item "`pandoc -f html -t latex $item/author`", "`cat $item/year`": "`cat $item/title`". " >> publications.tex
    if [[ `cat $item/status` == "published" ]]; then
        echo "\textit{"`cat $item/journal`"}, "`cat $item/issue`", "`cat $item/pages`". " >> publications.tex
        echo "\href{https://doi.org/"`cat $item/doi`"}{doi:"`cat $item/doi`"}." >> publications.tex
    fi
    if [[ `cat $item/status` == "in review" ]]; then
        echo "\textit{"`cat $item/journal`"}, in review." >> publications.tex
    fi
    if [[ `cat $item/status` == "in prep" ]]; then
        echo "in prep." >> publications.tex
    fi
    echo >> publications.tex
done
echo "\end{enumerate}" >> publications.tex

###presentation section
rm -f presentations.tex
echo "\begin{enumerate}" >> presentations.tex
for item in `find ../presentations/* -maxdepth 0 |sort -r`; do
    date=`basename $item`
    echo "\item "`pandoc -f html -t latex $item/author`"," >> presentations.tex
    if [ ! -f $item/poster.pdf ]; then
        echo "\textit{\`\`"`cat $item/title`"''}," >> presentations.tex
    else
        echo "\textit{\`\`"`cat $item/title`"''}(poster)," >> presentations.tex
    fi
    echo `cat $item/place`", "`$date_cmd -d $date +'%b %_d, %Y'` >> presentations.tex
    if [ -f $item/invited ]; then
        echo '(invited)' >> presentations.tex
    fi
    echo >> presentations.tex
done
echo "\end{enumerate}" >> presentations.tex

###build cv/main.pdf and main.html
latexmk -f -pdf -quiet main.tex

rm -f main.html
cat << EOF >> main.html
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
<link rel="stylesheet" href="../../style.css">

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

<title>Yue (Michael) Ying Curriculum Vitae</title>
</head>
<body>
  <div class="container">
    <div class="page" id="cv">
EOF

pandoc main.tex --mathjax -t html >> main.html

cat << EOF >> main.html
    </div>
  </div>

  <script>
    document.write('<div class="footer">');
    document.write('Last updated: ');
    document.write(document.lastModified.split(' ')[0]);
  </script>
</body>
</html>
EOF
