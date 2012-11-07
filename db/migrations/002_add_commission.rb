class AddCommission <  ActiveRecord::Migration
  def change 
    add_column :users, :commission, :decimal, :precision => 10, :scale => 2
  end
end
