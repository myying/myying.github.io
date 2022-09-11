#!/bin/bash



###publication section
rm publications.tex
echo "\begin{enumerate}" >> publications.tex

##read list in reverse order (newer first)
set -- ../publications/*
i=$#
while [ $i -gt 0 ]; do
    eval "item=\${$i}"  ##item in the publication list
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
    i=$((i-1))
done

echo "\end{enumerate}" >> publications.tex


###presentation section
rm presentations.tex
echo "\begin{enumerate}" >> presentations.tex

##read list in reverse order (newer first)
set -- ../presentations/*
i=$#
while [ $i -gt 0 ]; do
    eval "item=\${$i}"  ##date list
    date=`basename $item`
    echo "\item "`pandoc -f html -t latex $item/author`", \textit{\`\`"`cat $item/title`"''}, "`cat $item/place`", "`gdate -d $date +'%_d %b, %Y'` >> presentations.tex ###note: gdate works on macos, on linux use date
    if [ -f $item/invited ]; then
        echo '(invited)' >> presentations.tex
    fi
    echo >> presentations.tex
    i=$((i-1))
done

echo "\end{enumerate}" >> presentations.tex
