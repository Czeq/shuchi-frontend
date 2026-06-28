-- Create Reviews Table
CREATE TABLE IF NOT EXISTS product_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id VARCHAR(255) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_approved BOOLEAN DEFAULT FALSE
);

-- Index for faster queries by product_id
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON product_reviews(product_id);

-- Optional: Create a view for calculating average ratings
CREATE OR REPLACE VIEW product_rating_summary AS
SELECT 
    product_id,
    COUNT(id) as total_reviews,
    ROUND(AVG(rating), 1) as average_rating
FROM 
    product_reviews
WHERE 
    is_approved = TRUE
GROUP BY 
    product_id;
