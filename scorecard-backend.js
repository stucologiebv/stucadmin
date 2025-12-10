// Leverancier Scorecard System
// Voeg deze code toe aan server.js

const supplierReviews = {};

function calculateSupplierScore(supplierData) {
  const scores = {
    priceScore: 0,
    reliabilityScore: 0,
    qualityScore: 85, // Default - zou uit reviews komen
    overallScore: 0
  };
  
  // Prijs score (gebaseerd op gemiddelde factuur vs benchmark)
  const avgInvoice = supplierData.totalCost / (supplierData.invoiceCount || 1);
  const benchmark = 5000;
  scores.priceScore = Math.max(0, Math.min(100, 100 - ((avgInvoice / benchmark - 1) * 50)));
  
  // Betrouwbaarheid score (gebaseerd op aantal facturen = consistentie)
  scores.reliabilityScore = Math.min(100, (supplierData.invoiceCount || 0) * 10);
  
  // Check for manual reviews
  const reviews = supplierReviews[supplierData.supplier] || [];
  if (reviews.length > 0) {
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    scores.qualityScore = avgRating * 20; // Convert 1-5 to 0-100
  }
  
  // Overall score (weighted average)
  scores.overallScore = Math.round(
    scores.priceScore * 0.4 + 
    scores.reliabilityScore * 0.3 + 
    scores.qualityScore * 0.3
  );
  
  return scores;
}

// API: Get supplier scorecard
app.get('/api/supplier-scorecard', (req, res) => {
  try {
    if (!analysisData?.bySupplier) {
      return res.json({ suppliers: [] });
    }
    
    const scorecards = analysisData.bySupplier.map(supplier => {
      const scores = calculateSupplierScore(supplier);
      const rating = scores.overallScore >= 80 ? 5 : 
                     scores.overallScore >= 60 ? 4 : 
                     scores.overallScore >= 40 ? 3 : 2;
      
      return {
        supplier: supplier.supplier,
        totalSpent: supplier.totalCost,
        invoiceCount: supplier.invoiceCount,
        avgInvoiceAmount: Math.round(supplier.totalCost / (supplier.invoiceCount || 1)),
        ...scores,
        rating,
        recommendation: scores.overallScore >= 70 ? 'Preferred' : 
                        scores.overallScore >= 50 ? 'Approved' : 'Review'
      };
    });
    
    res.json({ 
      suppliers: scorecards.sort((a, b) => b.overallScore - a.overallScore) 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Add supplier review
app.post('/api/supplier-review', (req, res) => {
  const { supplier, rating, comment } = req.body;
  
  if (!supplier || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Ongeldige input' });
  }
  
  if (!supplierReviews[supplier]) {
    supplierReviews[supplier] = [];
  }
  
  supplierReviews[supplier].push({ 
    rating: parseInt(rating), 
    comment: comment || '',
    date: new Date().toISOString() 
  });
  
  res.json({ success: true, reviewCount: supplierReviews[supplier].length });
});

// API: Get supplier reviews
app.get('/api/supplier-reviews/:supplier', (req, res) => {
  const { supplier } = req.params;
  res.json({ reviews: supplierReviews[supplier] || [] });
});
