package importer

// DedupResult describes how an incoming row should be handled against known rows.
type DedupResult struct {
	Incoming    Candidate
	Disposition Disposition
	Matched     *Candidate
}

func ResolveDuplicate(existing []Candidate, incoming Candidate) DedupResult {
	normalized := NormalizeCandidate(incoming)
	var review *Candidate
	var newSense *Candidate
	for index := range existing {
		candidate := NormalizeCandidate(existing[index])
		disposition := ClassifyDuplicate(candidate, normalized)
		switch disposition {
		case DispositionExact:
			return DedupResult{Incoming: normalized, Disposition: disposition, Matched: &candidate}
		case DispositionReview:
			if review == nil {
				review = &candidate
			}
		case DispositionNewSense:
			if newSense == nil {
				newSense = &candidate
			}
		}
	}
	if review != nil {
		return DedupResult{Incoming: normalized, Disposition: DispositionReview, Matched: review}
	}
	if newSense != nil {
		return DedupResult{Incoming: normalized, Disposition: DispositionNewSense, Matched: newSense}
	}
	return DedupResult{Incoming: normalized, Disposition: DispositionInsert}
}
