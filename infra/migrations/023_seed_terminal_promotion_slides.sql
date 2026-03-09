-- Seed sample terminal promotion slides (carousel in trading terminal right panel).
-- Idempotent: only inserts when no slides exist.

INSERT INTO terminal_promotion_slides (sort_order, image_url, title, subtitle, link_url, link_label, is_active)
SELECT 0, 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=200&fit=crop', 'Premium Analytics', 'Track performance with advanced charts and real-time data.', 'https://example.com/analytics', 'Learn more', true
WHERE NOT EXISTS (SELECT 1 FROM terminal_promotion_slides LIMIT 1);

INSERT INTO terminal_promotion_slides (sort_order, image_url, title, subtitle, link_url, link_label, is_active)
SELECT 1, 'https://images.unsplash.com/photo-1640340434855-6084b1f4901c?w=400&h=200&fit=crop', 'Trade with confidence', 'Low spreads and fast execution on major pairs.', null, null, true
WHERE (SELECT COUNT(*) FROM terminal_promotion_slides) = 1;

INSERT INTO terminal_promotion_slides (sort_order, image_url, title, subtitle, link_url, link_label, is_active)
SELECT 2, 'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=400&h=200&fit=crop', '24/7 Support', 'Our team is here to help you succeed.', 'https://example.com/support', 'Contact support', true
WHERE (SELECT COUNT(*) FROM terminal_promotion_slides) = 2;
