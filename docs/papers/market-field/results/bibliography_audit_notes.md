# Bibliography audit notes

Audit date: 2026-07-23

`scripts/audit_references.py` checked all 38 BibTeX entries against Crossref DOI
metadata, Open Library ISBN metadata, or the cited source URL. The machine-readable
results are in `bibliography_audit.csv`.

- 30 DOI or ISBN records matched the cited title and year directly.
- Five non-DOI source pages were reachable and were inspected for title, author,
  and year: the two *Technical Analysis of Stocks & Commodities* SwamiCharts
  articles, MacQueen's Berkeley proceedings record, the Adams--MacKay arXiv
  record, and the Chung--Bellotti arXiv record.
- Perry Kaufman's ISBN record abbreviates the title to *Smarter Trading* while
  the catalog record supplies the same subtitle, author, publisher, and 1995
  edition used in the bibliography.
- Crossref abbreviates the Fabretti--Ausloos title after “critical regime”; the
  DOI, authors, journal, volume, pages, and 2005 year match the cited article.
- Crossref records the Bailey et al. DOI's online publication in 2016. The
  publisher places the article in *Journal of Computational Finance*, volume 20,
  number 4 (April 2017), pages 39--69; the bibliography retains the issue year
  2017 and the DOI.
- The Wilder author field is protected as the literal personal name
  “J. Welles Wilder Jr.” so the ICLR BibTeX style cannot invert the suffix.

The audit verifies bibliographic metadata, not the substantive interpretation
of every cited work. The submitting author remains responsible for the final
reference list and for the separate ICLR submission-form disclosure.
